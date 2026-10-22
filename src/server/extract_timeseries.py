from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from obspy import Stream, UTCDateTime

ROOT_DIR = Path(__file__).resolve().parents[2]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from backend.mseed_processing import (  # noqa: E402
    FILTER_TYPES,
    apply_filter_chain,
    build_continuous_record,
    filter_uses,
    find_mseed_files,
    parse_frequency_list,
    preprocess_signal,
    read_mseed_file,
)


def read_window(data_dir: Path, start: UTCDateTime, end: UTCDateTime, trace_id: str | None = None) -> Stream:
    """Le apenas os arquivos (e registros) que cruzam o intervalo [start, end]."""
    stream = Stream()

    for file_path in find_mseed_files(data_dir):
        try:
            header = read_mseed_file(file_path, headonly=True)
        except Exception:
            continue

        if any(tr.stats.starttime < end and tr.stats.endtime > start for tr in header):
            stream += read_mseed_file(file_path, starttime=start, endtime=end)

    if trace_id:
        stream = stream.select(id=trace_id)
    stream.sort(keys=["starttime"])
    return stream


def minmax_downsample(data: np.ndarray, max_points: int) -> tuple[np.ndarray, np.ndarray]:
    """
    Reduz a serie mantendo o minimo e o maximo de cada bloco.

    Diferente de amostrar indices igualmente espacados, preserva picos e spikes
    que, de outro modo, desapareceriam da visualizacao.
    """
    n = len(data)
    if n <= max_points:
        indices = np.arange(n)
        return indices, data.astype(float)

    n_bins = max(1, max_points // 2)
    edges = np.linspace(0, n, n_bins + 1).astype(int)
    indices: list[int] = []
    for a, b in zip(edges[:-1], edges[1:]):
        if b <= a:
            continue
        segment = data[a:b]
        i_min = a + int(np.argmin(segment))
        i_max = a + int(np.argmax(segment))
        indices.extend(sorted({i_min, i_max}))

    index_array = np.asarray(indices)
    return index_array, data[index_array].astype(float)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", type=Path, required=True)
    parser.add_argument("--start", required=True)
    parser.add_argument("--end", required=True)
    parser.add_argument("--max-points", type=int, default=900)
    parser.add_argument("--trace-id", help="Id NET.STA.LOC.CHA (aceita * e ?).")
    parser.add_argument("--filter-type", choices=FILTER_TYPES, help="Filtro de frequencia (padrao: bandpass se --freqmin e --freqmax forem informados).")
    parser.add_argument("--freqmin", type=float)
    parser.add_argument("--freqmax", type=float)
    parser.add_argument("--notch-freqs", type=parse_frequency_list, help="Frequencias do notch em Hz, ex.: '60,29'.")
    parser.add_argument("--notch-q", type=float, default=30.0)
    args = parser.parse_args()

    filter_type = args.filter_type
    if filter_type is None and args.freqmin is not None and args.freqmax is not None:
        filter_type = "bandpass"
    if filter_type is not None:
        uses_min, uses_max = filter_uses(filter_type)
        if (uses_min and args.freqmin is None) or (uses_max and args.freqmax is None):
            parser.error(f"O filtro '{filter_type}' precisa de " + ("--freqmin e --freqmax" if uses_min and uses_max else "--freqmin" if uses_min else "--freqmax"))
    if args.notch_freqs and (args.notch_q <= 0 or any(f <= 0 for f in args.notch_freqs)):
        parser.error("Frequencias de notch e --notch-q devem ser positivos.")

    start = UTCDateTime(args.start)
    end = UTCDateTime(args.end)
    if end <= start:
        raise ValueError("Fim UTC precisa ser maior que início UTC.")

    stream = read_window(args.data_dir, start, end, args.trace_id)
    trace_ids = sorted({tr.id for tr in stream})
    if not trace_ids:
        print(json.dumps({"points": [], "npts": 0, "traceIds": trace_ids, "gapCount": 0}))
        return

    trace_id = trace_ids[0]
    selected = stream.select(id=trace_id)
    gap_count = sum(1 for gap in selected.get_gaps() if gap[6] > 0)
    # Mesma montagem do pipeline: grade temporal absoluta, gaps interpolados.
    record = build_continuous_record(selected)
    fs = record.fs
    i0 = max(0, int(np.ceil((start - record.starttime) * fs)))
    i1 = min(len(record.data), int(np.floor((end - record.starttime) * fs)) + 1)
    data = record.data[i0:i1]
    filled = record.filled[i0:i1]
    window_start = record.starttime + i0 / fs
    npts = len(data)
    if npts == 0:
        print(json.dumps({"points": [], "npts": 0, "traceId": trace_id, "traceIds": trace_ids, "gapCount": gap_count}))
        return

    filtered = filter_type is not None or bool(args.notch_freqs)
    notch_applied: list[float] = []
    notch_skipped: list[float] = []
    if filtered:
        data = preprocess_signal(data, fs, taper_seconds=1.0, taper_max_fraction=0.05)
        chain = apply_filter_chain(
            data,
            fs,
            filter_type=filter_type,
            freqmin=args.freqmin if args.freqmin is not None else 1.0,
            freqmax=args.freqmax if args.freqmax is not None else 45.0,
            notch_freqs=args.notch_freqs,
            notch_q=args.notch_q,
        )
        data, notch_applied, notch_skipped = chain.data, chain.notch_applied, chain.notch_skipped

    indices, values = minmax_downsample(data, max(10, args.max_points))
    points = [{"t": float(index / fs), "v": float(value)} for index, value in zip(indices, values)]

    print(
        json.dumps(
            {
                "points": points,
                "npts": int(npts),
                "samplingRateHz": fs,
                "startUtc": str(window_start),
                "endUtc": str(window_start + (npts - 1) / fs),
                "traceId": trace_id,
                "traceIds": trace_ids,
                "gapCount": gap_count,
                "filledSamples": int(np.count_nonzero(filled)),
                "filtered": filtered,
                "filterType": filter_type,
                "notchApplied": notch_applied,
                "notchSkipped": notch_skipped,
            }
        )
    )


if __name__ == "__main__":
    try:
        main()
    except (FileNotFoundError, ValueError, RuntimeError) as exc:
        print(f"Erro: {exc}", file=sys.stderr)
        sys.exit(1)
