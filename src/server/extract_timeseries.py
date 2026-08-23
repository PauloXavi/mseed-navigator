from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from obspy import Stream, UTCDateTime, read


def find_mseed_files(data_dir: Path) -> list[Path]:
    patterns = ["*.mseed", "*.miniseed", "*.MSEED", "*.MINISEED", "*.seed", "*.msd"]
    files: list[Path] = []
    for pattern in patterns:
        files.extend(sorted(data_dir.rglob(pattern)))
    return sorted(files)


def read_window(data_dir: Path, start: UTCDateTime, end: UTCDateTime) -> Stream:
    stream = Stream()

    for file_path in find_mseed_files(data_dir):
        try:
            header = read(str(file_path), headonly=True)
        except Exception:
            continue

        if not header:
            continue

        stats = header[0].stats
        if stats.starttime < end and stats.endtime > start:
            stream += read(str(file_path))

    if not stream:
        return stream

    stream.sort(keys=["starttime"])
    stream.merge(method=1, fill_value="interpolate")
    stream.trim(starttime=start, endtime=end, pad=False)
    return stream


def downsample(data: np.ndarray, max_points: int) -> tuple[np.ndarray, np.ndarray]:
    if len(data) <= max_points:
        indices = np.arange(len(data))
        return indices, data.astype(float)

    indices = np.linspace(0, len(data) - 1, max_points).astype(int)
    return indices, data[indices].astype(float)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", type=Path, required=True)
    parser.add_argument("--start", required=True)
    parser.add_argument("--end", required=True)
    parser.add_argument("--max-points", type=int, default=900)
    args = parser.parse_args()

    start = UTCDateTime(args.start)
    end = UTCDateTime(args.end)
    if end <= start:
        raise ValueError("Fim UTC precisa ser maior que início UTC.")

    stream = read_window(args.data_dir, start, end)
    if not stream:
        print(json.dumps({"points": [], "npts": 0}))
        return

    trace = stream[0]
    data = trace.data.astype(np.float64)
    indices, values = downsample(data, max(10, args.max_points))
    fs = float(trace.stats.sampling_rate)
    points = [{"t": float(index / fs), "v": float(value)} for index, value in zip(indices, values)]

    print(
        json.dumps(
            {
                "points": points,
                "npts": int(trace.stats.npts),
                "samplingRateHz": fs,
                "startUtc": str(trace.stats.starttime),
                "endUtc": str(trace.stats.endtime),
            }
        )
    )


if __name__ == "__main__":
    main()
