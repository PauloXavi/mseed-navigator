"""
mSEED Navigator waveform processing
Analysis utilities for microseismic waveform data in MiniSEED format.

Autor: Paulo Gabriel Xavier Marques

Purpose:
    Compile, read, visualize, process and analyze microseismic waveform
    records using Python and ObsPy.

Principais etapas:
    1. Descoberta e leitura dos arquivos MiniSEED (selecao opcional de arquivos e de trace);
    2. Controle de qualidade: metadados por arquivo, gaps/overlaps e indicadores por janela;
    3. Montagem de um registro continuo com tratamento explicito de gaps;
    4. Deteccao de spikes impulsivos (residuo de mediana movel + MAD) e interpolacao;
    5. Remocao de media, detrend linear, taper cosseno e filtro Butterworth passa-banda;
    6. Analise espectral (PSD Welch, energia por banda e espectrograma);
    7. Deteccao de eventos candidatos por STA/LTA (classico ou recursivo) com metricas
       por evento (SNR, frequencia dominante e flags de QC);
    8. Exportacao de tabelas CSV, figuras PNG e dos parametros efetivamente usados (JSON).

Como executar:
    python backend/mseed_processing.py --data-dir examples/data --output-dir resultados
    python backend/mseed_processing.py --help   # lista todos os parametros

Dependencias:
    obspy, numpy, scipy, pandas, matplotlib
"""

from __future__ import annotations

import argparse
import io
import json
import os
import platform
import sys
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import matplotlib
import numpy as np
import pandas as pd

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.ticker import EngFormatter
import obspy
import scipy
from scipy.ndimage import median_filter
from scipy.signal import (
    bessel,
    butter,
    detrend as scipy_detrend,
    iirnotch,
    sosfilt,
    sosfiltfilt,
    spectrogram,
    tf2sos,
    welch,
)

from obspy import read, Stream, Trace, UTCDateTime
from obspy.signal.trigger import classic_sta_lta, recursive_sta_lta, trigger_onset


# -----------------------------------------------------------------------------
# Constantes
# -----------------------------------------------------------------------------

MSEED_SUFFIXES = (".mseed", ".miniseed", ".seed", ".msd")

SUMMARY_CSV = "resumo_por_arquivo.csv"
GLOBAL_CSV = "resumo_global.csv"
GAPS_CSV = "gaps.csv"
SPIKES_CSV = "spikes_detectados.csv"
PSD_CSV = "psd_welch.csv"
BANDS_CSV = "energia_por_banda.csv"
EVENTS_CSV = "eventos_candidatos_sta_lta.csv"
QC_WINDOWS_CSV = "indicadores_por_janela.csv"
PARAMS_JSON = "parametros_processamento.json"

FIG_OVERVIEW = "visao_geral_24h_bruto.png"
FIG_QC = "indicadores_por_minuto.png"
FIG_PSD = "psd_bruto_processado.png"
FIG_WINDOW = "janela_inicial_bruto_processado.png"
FIG_SPECTROGRAM = "espectrograma_janela_inicial.png"
FIG_STALTA = "funcao_sta_lta_24h.png"
FIG_EVENT = "principal_evento_candidato.png"
FIG_SPIKE = "janela_spike_bruto_processado.png"

GAP_FILL_METHODS = ("interpolate", "median")
SPIKE_METHODS = ("residual", "global")
STALTA_METHODS = ("classic", "recursive")
FILTER_TYPES = ("bandpass", "highpass", "lowpass", "bandstop")
FILTER_FAMILIES = ("butterworth", "bessel")
PIPELINE_STEPS = ("read", "qc", "despike", "preprocess", "bandpass", "psd", "stalta", "figures", "export")

DEFAULT_BANDS: Tuple[Tuple[float, float], ...] = (
    (0.1, 1.0),
    (1.0, 5.0),
    (5.0, 10.0),
    (10.0, 20.0),
    (20.0, 40.0),
    (40.0, 80.0),
    (80.0, 120.0),
)

GAP_COLUMNS = ["network", "station", "location", "channel", "gap_start", "gap_end", "gap_duration_s", "missing_samples", "type"]
SPIKE_COLUMNS = ["sample", "time_utc", "seconds_from_beginning", "raw_amplitude", "spike_id"]
PSD_COLUMNS = ["frequency_hz", "psd_raw", "psd_processed"]
BAND_COLUMNS = ["band_hz", "fmin_hz", "fmax_hz", "energy_raw", "energy_processed", "percent_raw", "percent_processed"]
EVENT_COLUMNS = [
    "event_id",
    "sample_on",
    "sample_off",
    "starttime_utc",
    "endtime_utc",
    "start_seconds_from_beginning",
    "duration_s",
    "max_sta_lta",
    "max_abs_amplitude_filtered",
    "rms_filtered",
    "peak_time_utc",
    "snr",
    "dominant_frequency_hz",
    "qc_flags",
]


# -----------------------------------------------------------------------------
# Configuracao
# -----------------------------------------------------------------------------


@dataclass
class ProcessingConfig:
    """Parametros do pipeline. Os valores padrao reproduzem o fluxo recomendado."""

    data_dir: Path
    output_dir: Path = Path("resultados")
    files: Optional[List[str]] = None
    trace_id: Optional[str] = None
    metadata_only: bool = False
    progress_file: Optional[Path] = None
    figure_dpi: int = 150
    # Controle de qualidade
    gap_fill: str = "interpolate"
    qc_window_seconds: float = 60.0
    # Spikes
    despike: bool = True
    spike_method: str = "residual"
    spike_z: float = 20.0
    spike_window: int = 7
    spike_max_width: int = 3
    # Pre-processamento e filtro
    demean: bool = True
    detrend: bool = True
    taper: bool = True
    taper_seconds: float = 30.0
    taper_max_fraction: float = 0.05
    # `bandpass` liga/desliga o filtro de frequencia (o nome foi mantido por compatibilidade
    # com jobs salvos e com a flag --bandpass); o tipo fica em `filter_type`.
    bandpass: bool = True
    filter_type: str = "bandpass"
    filter_family: str = "butterworth"
    freqmin: float = 1.0
    freqmax: float = 45.0
    filter_order: int = 4
    zero_phase: bool = True
    notch: bool = False
    notch_freqs: List[float] = field(default_factory=lambda: [60.0])
    notch_q: float = 30.0
    # Analise espectral
    psd: bool = True
    welch_nperseg: int = 8192
    welch_overlap: float = 0.5
    bands: List[Tuple[float, float]] = field(default_factory=lambda: list(DEFAULT_BANDS))
    spectrogram: bool = True
    spectrogram_nperseg: int = 256
    window_start: float = 0.0
    window_seconds: float = 600.0
    # STA/LTA
    stalta: bool = True
    stalta_method: str = "classic"
    sta: float = 0.5
    lta: float = 5.0
    trigger_on: float = 8.0
    trigger_off: float = 2.0
    max_event_seconds: float = 5.0
    min_event_seconds: float = 0.0
    # Qualidade dos eventos (desligado por padrao: resultado identico ao anterior)
    low_snr_flag: bool = False
    low_snr_threshold: float = 3.0
    min_event_snr: float = 0.0

    def validate(self) -> None:
        """Valida combinacoes de parametros independentes da taxa de amostragem."""
        errors = []
        if self.gap_fill not in GAP_FILL_METHODS:
            errors.append(f"gap_fill deve ser um de {GAP_FILL_METHODS}")
        if self.spike_method not in SPIKE_METHODS:
            errors.append(f"spike_method deve ser um de {SPIKE_METHODS}")
        if self.stalta_method not in STALTA_METHODS:
            errors.append(f"stalta_method deve ser um de {STALTA_METHODS}")
        if self.spike_z <= 0:
            errors.append("spike_z deve ser positivo")
        if self.spike_window < 3:
            errors.append("spike_window deve ter pelo menos 3 amostras")
        if self.spike_max_width < 1:
            errors.append("spike_max_width deve ser >= 1 amostra")
        if self.taper_seconds < 0:
            errors.append("taper_seconds nao pode ser negativo")
        if not 0.0 <= self.taper_max_fraction <= 0.5:
            errors.append("taper_max_fraction deve estar entre 0 e 0.5")
        if self.filter_type not in FILTER_TYPES:
            errors.append(f"filter_type deve ser um de {FILTER_TYPES}")
        if self.filter_family not in FILTER_FAMILIES:
            errors.append(f"filter_family deve ser um de {FILTER_FAMILIES}")
        uses_min, uses_max = filter_uses(self.filter_type)
        if uses_min and self.freqmin <= 0:
            errors.append("freqmin deve ser positiva")
        if uses_max and self.freqmax <= 0:
            errors.append("freqmax deve ser positiva")
        if uses_min and uses_max and self.freqmax <= self.freqmin:
            errors.append("freqmax deve ser maior que freqmin")
        if self.notch:
            if not self.notch_freqs:
                errors.append("informe ao menos uma frequencia de notch")
            if any(not np.isfinite(f) or f <= 0 for f in self.notch_freqs):
                errors.append("frequencias de notch devem ser positivas")
            if not np.isfinite(self.notch_q) or self.notch_q <= 0:
                errors.append("notch_q deve ser positivo")
        if not 1 <= self.filter_order <= 10:
            errors.append("filter_order deve estar entre 1 e 10")
        if self.welch_nperseg < 16:
            errors.append("welch_nperseg deve ser >= 16")
        if not 0.0 <= self.welch_overlap < 1.0:
            errors.append("welch_overlap deve estar em [0, 1)")
        if self.spectrogram_nperseg < 16:
            errors.append("spectrogram_nperseg deve ser >= 16")
        if self.window_start < 0:
            errors.append("window_start nao pode ser negativo")
        if self.window_seconds <= 0:
            errors.append("window_seconds deve ser positivo")
        if self.sta <= 0:
            errors.append("sta deve ser positivo")
        if self.lta <= self.sta:
            errors.append("lta deve ser maior que sta")
        if self.trigger_on <= 0:
            errors.append("trigger_on deve ser positivo")
        if not 0 <= self.trigger_off < self.trigger_on:
            errors.append("trigger_off deve estar em [0, trigger_on)")
        if self.max_event_seconds < 0:
            errors.append("max_event_seconds nao pode ser negativo (0 = sem limite)")
        if self.min_event_seconds < 0:
            errors.append("min_event_seconds nao pode ser negativo")
        if not np.isfinite(self.low_snr_threshold) or self.low_snr_threshold <= 0:
            errors.append("low_snr_threshold deve ser positivo")
        if not np.isfinite(self.min_event_snr) or self.min_event_snr < 0:
            errors.append("min_event_snr nao pode ser negativo (0 = nao descarta)")
        # Abaixo de 1 s, 24 h viram dezenas de milhoes de janelas (horas de processamento e
        # um CSV de gigabytes).
        if not self.qc_window_seconds >= 1.0:
            errors.append("qc_window_seconds deve ser >= 1 s")
        if not 50 <= self.figure_dpi <= 600:
            errors.append("figure_dpi deve estar entre 50 e 600")
        for fmin, fmax in self.bands:
            if fmin < 0 or fmax <= fmin:
                errors.append(f"banda invalida: {fmin}-{fmax}")
        if errors:
            raise ValueError("; ".join(errors))


def filter_uses(filter_type: str) -> Tuple[bool, bool]:
    """Indica se o tipo de filtro usa (freqmin, freqmax)."""
    return filter_type in ("bandpass", "highpass", "bandstop"), filter_type in ("bandpass", "lowpass", "bandstop")


def parse_frequency_list(text: str) -> List[float]:
    """Converte '60, 29' em [60.0, 29.0] (frequencias de notch)."""
    freqs = []
    for item in text.split(","):
        item = item.strip()
        if not item:
            continue
        try:
            freqs.append(float(item))
        except ValueError as exc:
            raise argparse.ArgumentTypeError(f"Frequencia invalida '{item}'. Use numeros separados por virgula.") from exc
    if not freqs:
        raise argparse.ArgumentTypeError("Informe ao menos uma frequencia.")
    return freqs


def parse_bands(text: str) -> List[Tuple[float, float]]:
    """Converte '0.1-1,1-5,5-10' em [(0.1, 1.0), (1.0, 5.0), (5.0, 10.0)]."""
    bands = []
    for item in text.split(","):
        item = item.strip()
        if not item:
            continue
        try:
            fmin_text, fmax_text = item.split("-")
            bands.append((float(fmin_text), float(fmax_text)))
        except ValueError as exc:
            raise argparse.ArgumentTypeError(f"Banda invalida '{item}'. Use o formato fmin-fmax.") from exc
    if not bands:
        raise argparse.ArgumentTypeError("Informe ao menos uma banda.")
    return bands


# -----------------------------------------------------------------------------
# Utilidades gerais
# -----------------------------------------------------------------------------


def find_mseed_files(data_dir: Path, names: Optional[Sequence[str]] = None) -> List[Path]:
    """
    Localiza arquivos MiniSEED dentro do diretorio de dados (busca recursiva).

    A extensao e comparada sem distincao de maiusculas/minusculas e cada arquivo
    aparece uma unica vez. Se `names` for informado, apenas arquivos com esses
    nomes (sem caminho) sao retornados.
    """
    data_dir = Path(data_dir)
    if not data_dir.is_dir():
        raise FileNotFoundError(f"Diretorio de dados nao encontrado: {data_dir}")

    files = sorted({p for p in data_dir.rglob("*") if p.is_file() and p.suffix.lower() in MSEED_SUFFIXES})
    if names:
        wanted = set(names)
        files = [p for p in files if p.name in wanted]
    return files


def read_mseed_file(
    path: Path,
    headonly: bool = False,
    starttime: Optional[UTCDateTime] = None,
    endtime: Optional[UTCDateTime] = None,
) -> Stream:
    """
    Le um arquivo MiniSEED decodificando os bytes ja carregados em memoria.

    `obspy.read(caminho)` testa compactacao (tar/zip) e cria um memmap a cada arquivo
    (~3 ms por arquivo). Com 1440 arquivos de 1 minuto isso dominava o tempo total;
    decodificar os bytes e cerca de 10x mais rapido. Se o conteudo nao for MiniSEED
    puro (ex.: volume SEED completo), cai na deteccao automatica do ObsPy.
    """
    kwargs: Dict[str, object] = {"headonly": headonly}
    if starttime is not None:
        kwargs["starttime"] = starttime
    if endtime is not None:
        kwargs["endtime"] = endtime
    try:
        return read(io.BytesIO(Path(path).read_bytes()), format="MSEED", **kwargs)
    except Exception:
        return read(str(path), **kwargs)


def read_files_by_source(files: Sequence[Path]) -> List[Tuple[Path, Stream]]:
    """Le cada arquivo MiniSEED e preserva a associacao arquivo -> Stream."""
    if not files:
        raise FileNotFoundError("Nenhum arquivo MiniSEED encontrado.")

    loaded: List[Tuple[Path, Stream]] = []
    failed = []
    for file in files:
        try:
            loaded.append((Path(file), read_mseed_file(Path(file))))
        except Exception as exc:  # leitura defensiva: um arquivo corrompido nao interrompe o lote
            failed.append((str(file), str(exc)))

    if failed:
        print("Arquivos com falha de leitura:")
        for filename, error in failed:
            print(f"  - {filename}: {error}")

    return loaded


def read_files(files: Sequence[Path]) -> Stream:
    """Ler todos os arquivos MiniSEED e retorna um Stream ObsPy."""
    stream = Stream()
    for _, file_stream in read_files_by_source(files):
        stream += file_stream
    stream.sort(keys=["network", "station", "location", "channel", "starttime"])
    return stream


def select_trace_id(stream: Stream, trace_id: Optional[str] = None) -> Tuple[Stream, str]:
    """
    Seleciona um unico id NET.STA.LOC.CHA do Stream.

    `trace_id` aceita curingas (* e ?). Sem `trace_id`, o Stream precisa conter
    exatamente um id; caso contrario a mensagem lista os ids disponiveis.
    """
    ids = sorted({tr.id for tr in stream})
    if trace_id:
        selected = stream.select(id=trace_id)
        selected_ids = sorted({tr.id for tr in selected})
        if not selected_ids:
            raise ValueError(f"Nenhum trace corresponde a '{trace_id}'. Ids disponiveis: {ids}")
        if len(selected_ids) > 1:
            raise ValueError(f"'{trace_id}' corresponde a varios ids: {selected_ids}. Use um padrao mais especifico.")
        return selected, selected_ids[0]

    if len(ids) != 1:
        raise ValueError(f"Foram encontrados multiplos canais/ids: {ids}. Use --trace-id para escolher um deles.")
    return stream, ids[0]


@dataclass
class ContinuousRecord:
    """
    Registro continuo de um unico trace na grade temporal absoluta.

    `filled` marca as amostras inseridas em gaps reais. Ajustes de alinhamento causados
    por deriva de relogio (segmentos contiguos cujos tempos de cabecalho se afastam da
    grade nominal) nao sao gaps: ficam em `timing_inserted`/`timing_dropped`, com a
    deriva estimada em `clock_drift_ppm`.
    """

    trace_id: str
    data: np.ndarray
    filled: np.ndarray
    fs: float
    starttime: UTCDateTime
    stats: obspy.core.trace.Stats
    timing_inserted: int = 0
    timing_dropped: int = 0
    clock_drift_ppm: float = 0.0
    overlap_samples: int = 0

    @property
    def endtime(self) -> UTCDateTime:
        return self.starttime + (len(self.data) - 1) / self.fs

    @property
    def effective_sampling_rate(self) -> float:
        """Taxa de amostragem implicita nos tempos de cabecalho (nominal corrigida pela deriva)."""
        return self.fs / (1.0 + self.clock_drift_ppm * 1e-6)


def build_continuous_record(stream: Stream, gap_fill: str = "interpolate") -> ContinuousRecord:
    """
    Une os segmentos de um unico id em um registro continuo na grade temporal correta.

    Cada segmento e posicionado pelo seu proprio tempo de inicio, arredondado para a
    grade nominal (mesma convencao do merge do ObsPy, mas em O(n): o merge encadeado
    concatena arrays mascarados a cada segmento e fica quadratico com milhares de
    arquivos curtos). Em overlaps, o segmento posterior prevalece (ObsPy method=1).

    Amostras faltantes sao preenchidas (interpolacao linear ou mediana do registro).
    Quando a fronteira entre segmentos e contigua pelos cabecalhos (|desvio| < 0,5
    amostra) mas o desvio acumulado desloca o segmento na grade, a amostra inserida ou
    descartada e contabilizada como ajuste de deriva de relogio, nao como gap.
    """
    if len(stream) == 0:
        raise RuntimeError("Nenhum Trace foi lido.")

    ids = sorted({tr.id for tr in stream})
    if len(ids) != 1:
        raise ValueError(f"Foram encontrados multiplos canais/ids: {ids}. Processar separadamente.")

    rates = sorted({float(tr.stats.sampling_rate) for tr in stream})
    if len(rates) != 1:
        raise ValueError(f"Taxas de amostragem diferentes para {ids[0]}: {rates} Hz. Reamostre antes de processar.")

    fs = rates[0]
    traces = sorted((tr for tr in stream if tr.stats.npts > 0), key=lambda tr: tr.stats.starttime)
    if not traces:
        raise ValueError("O registro nao contem amostras validas.")
    t0 = traces[0].stats.starttime
    offsets = [int(round((tr.stats.starttime - t0) * fs)) for tr in traces]
    npts = max(offset + tr.stats.npts for offset, tr in zip(offsets, traces))

    data = np.zeros(npts, dtype=np.float64)
    covered = np.zeros(npts, dtype=bool)
    timing_fill = np.zeros(npts, dtype=bool)
    timing_dropped = 0
    overlap_samples = 0
    drift_samples = 0.0
    contiguous_npts = 0
    grid_end = 0  # primeira posicao apos o segmento anterior

    for index, (offset, tr) in enumerate(zip(offsets, traces)):
        if index > 0:
            prev = traces[index - 1]
            # Desvio da fronteira em amostras, pelos cabecalhos: 0 = segmentos contiguos.
            boundary = (tr.stats.starttime - prev.stats.endtime) * fs - 1.0
            shift = offset - grid_end
            if abs(boundary) < 0.5:
                drift_samples += boundary
                contiguous_npts += prev.stats.npts
                if shift > 0:
                    timing_fill[grid_end:offset] = True
                elif shift < 0:
                    timing_dropped += -shift
            elif shift < 0:
                overlap_samples += -shift
        segment = tr.data
        values = np.asarray(np.ma.getdata(segment), dtype=np.float64)
        data[offset : offset + len(values)] = values
        covered[offset : offset + len(values)] = ~np.ma.getmaskarray(segment)
        grid_end = max(grid_end, offset + len(values))

    missing = ~covered
    if missing.all():
        raise ValueError("O registro nao contem amostras validas.")
    if missing.any():
        if gap_fill == "interpolate":
            idx = np.arange(npts)
            data[missing] = np.interp(idx[missing], idx[covered], data[covered])
        elif gap_fill == "median":
            data[missing] = float(np.median(data[covered]))
        else:
            raise ValueError(f"Metodo de preenchimento de gaps desconhecido: {gap_fill}")

    timing_fill &= missing
    stats = traces[0].stats.copy()
    stats.npts = npts
    return ContinuousRecord(
        trace_id=ids[0],
        data=data,
        filled=missing & ~timing_fill,
        fs=fs,
        starttime=t0,
        stats=stats,
        timing_inserted=int(np.count_nonzero(timing_fill)),
        timing_dropped=int(timing_dropped),
        clock_drift_ppm=float(drift_samples / contiguous_npts * 1e6) if contiguous_npts else 0.0,
        overlap_samples=int(overlap_samples),
    )


def stream_to_continuous_trace(stream: Stream, gap_fill: str = "interpolate") -> Trace:
    """
    Converte o Stream para um unico Trace continuo.

    Para datasets com apenas uma estacao/canal, gera um Trace continuo. Em datasets com
    multiplos canais, selecione o canal antes com `select_trace_id`.
    """
    record = build_continuous_record(stream, gap_fill=gap_fill)
    header = {
        key: record.stats[key]
        for key in ("network", "station", "location", "channel", "sampling_rate", "starttime", "calib")
    }
    return Trace(data=record.data, header=header)


def ensure_dirs(output_dir: Path) -> Tuple[Path, Path]:
    fig_dir = output_dir / "figuras"
    tab_dir = output_dir / "tabelas"
    fig_dir.mkdir(parents=True, exist_ok=True)
    tab_dir.mkdir(parents=True, exist_ok=True)
    return fig_dir, tab_dir


class ProgressReporter:
    """Publica o andamento do pipeline em um arquivo JSON (lido pela interface web)."""

    def __init__(self, path: Optional[Path]):
        self.path = Path(path) if path else None

    def update(self, step: str, message: str) -> None:
        print(f"{message}...")
        index = PIPELINE_STEPS.index(step) if step in PIPELINE_STEPS else 0
        self._write(
            {
                "status": "running",
                "step": step,
                "progress": round(100 * index / len(PIPELINE_STEPS)),
                "message": message,
            }
        )

    def done(self, summary: Dict[str, object]) -> None:
        self._write({"status": "completed", "step": "export", "progress": 100, "message": "Concluido", "summary": summary})

    def fail(self, error: str) -> None:
        self._write({"status": "error", "message": error})

    def _write(self, payload: Dict[str, object]) -> None:
        if self.path is None:
            return
        payload["updated_at_utc"] = datetime.now(timezone.utc).isoformat()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_name(self.path.name + ".tmp")
        tmp.write_text(json.dumps(payload, default=str), encoding="utf-8")
        os.replace(tmp, self.path)


# -----------------------------------------------------------------------------
# Controle de qualidade e estatisticas
# -----------------------------------------------------------------------------


def _basic_stats(data: np.ndarray) -> Dict[str, float]:
    if data.size == 0:
        return {key: float("nan") for key in ("min", "max", "mean", "std", "p99_abs", "peak_abs", "median", "rms")}
    abs_data = np.abs(data)
    return {
        "min": float(np.min(data)),
        "max": float(np.max(data)),
        "mean": float(np.mean(data)),
        "std": float(np.std(data)),
        "p99_abs": float(np.percentile(abs_data, 99)),
        "peak_abs": float(np.max(abs_data)),
        "median": float(np.median(data)),
        "rms": float(np.sqrt(np.mean(data**2))),
    }


def summarize_files(file_streams: Sequence[Tuple[Path, Stream]], trace_id: Optional[str] = None) -> pd.DataFrame:
    """Gera uma tabela de metadados e estatisticas por arquivo/Trace (uma linha por Trace)."""
    rows = []
    for file, file_stream in file_streams:
        for tr in file_stream:
            if trace_id and tr.id != trace_id:
                continue
            data = np.asarray(tr.data, dtype=np.float64)
            fs = float(tr.stats.sampling_rate)
            rows.append(
                {
                    "arquivo": file.name,
                    "id": tr.id,
                    "network": tr.stats.network,
                    "station": tr.stats.station,
                    "location": tr.stats.location,
                    "channel": tr.stats.channel,
                    "starttime_utc": str(tr.stats.starttime),
                    "endtime_utc": str(tr.stats.endtime),
                    "duration_s": float(tr.stats.npts / fs) if fs > 0 else 0.0,
                    "sampling_rate_hz": fs,
                    "npts": int(tr.stats.npts),
                    **_basic_stats(data),
                }
            )
    summary = pd.DataFrame(rows)
    if not summary.empty:
        summary = summary.sort_values(["starttime_utc", "arquivo"], kind="stable").reset_index(drop=True)
    return summary


def gaps_table(stream: Stream) -> pd.DataFrame:
    """Lista gaps (duracao > 0) e overlaps (duracao < 0) reportados pelo ObsPy."""
    gaps = stream.get_gaps()
    table = pd.DataFrame(gaps, columns=GAP_COLUMNS[:-1])
    table["gap_start"] = table["gap_start"].astype(str)
    table["gap_end"] = table["gap_end"].astype(str)
    table["type"] = np.where(table["gap_duration_s"].astype(float) < 0, "overlap", "gap")
    return table[GAP_COLUMNS]


def window_qc_table(
    raw: np.ndarray,
    processed: np.ndarray,
    fs: float,
    starttime: UTCDateTime,
    window_s: float,
    spike_mask: np.ndarray,
    filled_mask: np.ndarray,
) -> pd.DataFrame:
    """
    Indicadores de QC em janelas fixas do registro continuo (independente da divisao em arquivos).

    Amplitudes sao medidas em relacao a media da janela para que offsets DC nao dominem
    os indicadores. `rms_processed` mede o nivel de ruido na banda do filtro.
    """
    n = max(1, int(round(window_s * fs)))
    rows = []
    for index, i0 in enumerate(range(0, len(raw), n)):
        i1 = min(len(raw), i0 + n)
        seg = raw[i0:i1]
        dev = np.abs(seg - np.mean(seg))
        proc = processed[i0:i1]
        std = float(np.std(seg))
        rows.append(
            {
                "window_index": index,
                "starttime_utc": str(starttime + i0 / fs),
                "seconds_from_beginning": float(i0 / fs),
                "duration_s": float((i1 - i0) / fs),
                "npts": int(i1 - i0),
                "mean": float(np.mean(seg)),
                "std": std,
                "p99_abs_dev": float(np.percentile(dev, 99)),
                "peak_abs_dev": float(np.max(dev)),
                "rms_processed": float(np.sqrt(np.mean(proc**2))),
                "spike_count": int(np.count_nonzero(spike_mask[i0:i1])),
                "filled_fraction": float(np.mean(filled_mask[i0:i1])),
                "flatline": bool(std == 0.0),
            }
        )
    return pd.DataFrame(rows)


def _robust_sigma(values: np.ndarray) -> Tuple[float, float, float]:
    """Retorna (mediana, MAD, sigma robusto). Usa o desvio medio absoluto se MAD = 0."""
    median = float(np.median(values))
    deviation = np.abs(values - median)
    mad = float(np.median(deviation))
    if mad > 0:
        return median, mad, mad / 0.6745
    mean_abs = float(np.mean(deviation))
    return median, mad, mean_abs * 1.2533 if mean_abs > 0 else 0.0


def robust_spike_mask(data: np.ndarray, z_threshold: float = 20.0) -> Tuple[np.ndarray, float, float]:
    """
    Metodo legado ('global'): z-score robusto do sinal bruto inteiro.

    z_robusto = 0.6745 * |x - mediana| / MAD

    Atencao: como opera sobre a amplitude absoluta do registro, este metodo tambem
    marca eventos reais de grande amplitude. Mantido para comparacao/reprodutibilidade.
    """
    x = data.astype(np.float64)
    median = float(np.median(x))
    mad = float(np.median(np.abs(x - median)))
    if mad == 0:
        return np.zeros_like(x, dtype=bool), median, mad

    robust_z = 0.6745 * np.abs(x - median) / mad
    mask = robust_z > z_threshold
    return mask, median, mad


def residual_spike_mask(
    data: np.ndarray,
    z_threshold: float = 20.0,
    window: int = 7,
    max_width: int = 3,
) -> Tuple[np.ndarray, float, float]:
    """
    Identifica spikes impulsivos pelo residuo de uma mediana movel.

    1. linha de base = mediana movel de `window` amostras (segue sinais de banda limitada,
       mas descarta excursoes de poucas amostras);
    2. candidatos: z robusto do residuo x - linha_de_base acima do limiar, com MAD global
       do proprio residuo;
    3. confirmacao local (identificador de Hampel): o desvio do candidato em relacao a
       mediana da vizinhanca (3 * `window` amostras) tambem precisa exceder o limiar em
       unidades do MAD dessa vizinhanca. Isso rejeita picos de transientes suaves de
       alta SNR, cuja vizinhanca varia tanto quanto o proprio pico;
    4. candidatos confirmados sao agrupados (distancia <= `window`); somente grupos com
       extensao <= `max_width` amostras sao spikes. Grupos mais longos correspondem a
       energia sustentada (possivel evento) e sao preservados.

    Retorna (mascara, mediana_residuo, sigma_robusto_residuo).
    """
    x = data.astype(np.float64)
    mask = np.zeros(len(x), dtype=bool)
    window = int(window) | 1  # mediana movel com tamanho impar
    if len(x) < window:
        return mask, 0.0, 0.0

    residual = x - median_filter(x, size=window, mode="nearest")
    median, _, sigma = _robust_sigma(residual)
    if sigma == 0:
        return mask, median, sigma

    candidates = np.flatnonzero(np.abs(residual - median) / sigma > z_threshold)
    if candidates.size == 0:
        return mask, median, sigma

    half = (3 * window) // 2
    neighborhood = np.clip(candidates[:, None] + np.arange(-half, half + 1), 0, len(x) - 1)
    values = x[neighborhood]
    local_median = np.median(values, axis=1)
    local_sigma = np.median(np.abs(values - local_median[:, None]), axis=1) / 0.6745
    deviation = np.abs(x[candidates] - local_median)
    confirmed = (local_sigma == 0) | (deviation > z_threshold * local_sigma)
    candidates = candidates[confirmed]
    if candidates.size == 0:
        return mask, median, sigma

    breaks = np.flatnonzero(np.diff(candidates) > window) + 1
    for cluster in np.split(candidates, breaks):
        first, last = int(cluster[0]), int(cluster[-1])
        if last - first + 1 <= max_width:
            mask[first : last + 1] = True
    return mask, median, sigma


def label_runs(mask: np.ndarray) -> np.ndarray:
    """Numera trechos consecutivos True da mascara (1, 2, ...); False recebe 0."""
    starts = mask & ~np.concatenate(([False], mask[:-1]))
    return np.where(mask, np.cumsum(starts), 0)


def replace_spikes_by_interpolation(data: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """Substitui amostras marcadas como spikes por interpolacao linear."""
    x = data.astype(np.float64).copy()
    if not np.any(mask) or np.all(mask):
        return x

    idx = np.arange(len(x))
    good = ~mask
    x[mask] = np.interp(idx[mask], idx[good], x[good])
    return x


def taper_length(npts: int, fs: float, taper_seconds: float, max_fraction: Optional[float] = 0.05) -> int:
    """Numero de amostras do taper em cada borda (limitado a uma fracao do registro)."""
    n_taper = int(taper_seconds * fs)
    if max_fraction is not None:
        n_taper = min(n_taper, int(max_fraction * npts))
    n_taper = min(n_taper, npts // 2)
    return n_taper if n_taper > 1 else 0


def apply_cosine_taper(
    data: np.ndarray,
    fs: float,
    taper_seconds: float = 30.0,
    max_fraction: Optional[float] = 0.05,
) -> np.ndarray:
    """
    Aplica taper cosseno apenas nas bordas do registro.

    O taper reduz artefatos de borda durante filtragem e analise espectral. A duracao
    e limitada em segundos e tambem a `max_fraction` do registro em cada borda, para
    nao atenuar uma parcela excessiva de registros curtos.
    """
    x = data.astype(np.float64).copy()
    if taper_seconds <= 0:
        return x

    n_taper = taper_length(len(x), fs, taper_seconds, max_fraction)
    if n_taper <= 1:
        return x

    ramp = 0.5 * (1.0 - np.cos(np.linspace(0.0, np.pi, n_taper)))
    x[:n_taper] *= ramp
    x[-n_taper:] *= ramp[::-1]
    return x


def preprocess_signal(
    data: np.ndarray,
    fs: float,
    taper_seconds: float = 30.0,
    demean: bool = True,
    detrend: bool = True,
    taper: bool = True,
    taper_max_fraction: Optional[float] = 0.05,
) -> np.ndarray:
    """
    Realiza pre-processamento antes da filtragem.

    Etapas (cada uma pode ser desativada):
        1. remocao da media;
        2. remocao de tendencia linear;
        3. taper cosseno limitado as bordas.
    """
    x = data.astype(np.float64)
    if demean:
        x = x - np.mean(x)
    if detrend:
        x = scipy_detrend(x, type="linear")
    if taper:
        x = apply_cosine_taper(x, fs=fs, taper_seconds=taper_seconds, max_fraction=taper_max_fraction)
    return x


# -----------------------------------------------------------------------------
# Processamento de sinais
# -----------------------------------------------------------------------------


def effective_freqmax(fs: float, freqmax: float) -> float:
    """Limita freqmax a 95% de Nyquist (o filtro digital nao pode alcancar Nyquist)."""
    nyquist = 0.5 * fs
    return 0.95 * nyquist if freqmax >= nyquist else freqmax


def design_frequency_filter(
    fs: float,
    filter_type: str = "bandpass",
    freqmin: float = 1.0,
    freqmax: float = 45.0,
    order: int = 4,
    family: str = "butterworth",
) -> np.ndarray:
    """
    Projeta o filtro de frequencia em secoes de segunda ordem (SOS).

    freqmax e limitada a 95% de Nyquist. Bessel usa norm='mag' para que freqmin/freqmax
    sejam pontos de -3 dB, como no Butterworth (o padrao do SciPy, 'phase', deslocaria
    o corte e mudaria o significado dos campos na interface).
    """
    if filter_type not in FILTER_TYPES:
        raise ValueError(f"Tipo de filtro desconhecido: {filter_type}")
    if family not in FILTER_FAMILIES:
        raise ValueError(f"Familia de filtro desconhecida: {family}")
    nyquist = 0.5 * fs
    uses_min, uses_max = filter_uses(filter_type)
    if uses_max:
        freqmax = effective_freqmax(fs, freqmax)
    if uses_min and not 0 < freqmin < nyquist:
        raise ValueError(f"freqmin ({freqmin} Hz) deve estar entre 0 e Nyquist ({nyquist:g} Hz).")
    if uses_min and uses_max and freqmin >= freqmax:
        raise ValueError(f"Banda do filtro invalida para fs={fs} Hz: {freqmin}-{freqmax} Hz.")
    if uses_min and uses_max:
        cutoff: object = [freqmin, freqmax]
    else:
        cutoff = freqmin if uses_min else freqmax
    if family == "bessel":
        return bessel(order, cutoff, btype=filter_type, fs=fs, output="sos", norm="mag")
    return butter(order, cutoff, btype=filter_type, fs=fs, output="sos")


def frequency_filter(
    data: np.ndarray,
    fs: float,
    filter_type: str = "bandpass",
    freqmin: float = 1.0,
    freqmax: float = 45.0,
    order: int = 4,
    zero_phase: bool = True,
    family: str = "butterworth",
) -> np.ndarray:
    """
    Aplica o filtro de frequencia (passa-banda, passa-alta, passa-baixa ou rejeita-banda).

    zero_phase=True usa filtragem ida-e-volta (sem distorcao de fase, ordem efetiva 2x,
    porem acausal: pode antecipar o inicio aparente de eventos). zero_phase=False usa
    filtro causal, preferivel quando o tempo de chegada importa.
    """
    sos = design_frequency_filter(fs, filter_type, freqmin, freqmax, order, family)
    x = data.astype(np.float64)
    return sosfiltfilt(sos, x) if zero_phase else sosfilt(sos, x)


def bandpass_filter(
    data: np.ndarray,
    fs: float,
    freqmin: float,
    freqmax: float,
    order: int = 4,
    zero_phase: bool = True,
) -> np.ndarray:
    """Butterworth passa-banda (atalho de `frequency_filter`, mantido por compatibilidade)."""
    return frequency_filter(data, fs, "bandpass", freqmin, freqmax, order, zero_phase)


def notch_filter(
    data: np.ndarray,
    fs: float,
    freqs: Sequence[float],
    q: float = 30.0,
    zero_phase: bool = True,
) -> Tuple[np.ndarray, List[float], List[float]]:
    """
    Remove frequencias isoladas (ex.: 60 Hz da rede eletrica) com filtros notch IIR.

    A largura do corte e f0/Q (Q = 30 em 60 Hz remove ~59-61 Hz). Frequencias >= Nyquist
    nao podem ser representadas no registro e sao ignoradas. Retorna o sinal filtrado e
    as listas de frequencias aplicadas e ignoradas.
    """
    nyquist = 0.5 * fs
    applied = [float(f) for f in freqs if f < nyquist]
    skipped = [float(f) for f in freqs if f >= nyquist]
    x = data.astype(np.float64)
    if not applied:
        return x, applied, skipped
    sos = np.vstack([tf2sos(*iirnotch(f0, q, fs=fs)) for f0 in applied])
    return (sosfiltfilt(sos, x) if zero_phase else sosfilt(sos, x)), applied, skipped


@dataclass
class FilterChainResult:
    data: np.ndarray
    notch_applied: List[float]
    notch_skipped: List[float]


def apply_filter_chain(
    x: np.ndarray,
    fs: float,
    filter_type: Optional[str] = "bandpass",
    freqmin: float = 1.0,
    freqmax: float = 45.0,
    order: int = 4,
    zero_phase: bool = True,
    family: str = "butterworth",
    notch_freqs: Optional[Sequence[float]] = None,
    notch_q: float = 30.0,
) -> FilterChainResult:
    """
    Filtragem do sinal ja pre-processado: notch (se houver frequencias) e depois o filtro
    de frequencia (se `filter_type` nao for None). Usada pelo pipeline e pela aba Inspecao.
    """
    applied: List[float] = []
    skipped: List[float] = []
    if notch_freqs:
        x, applied, skipped = notch_filter(x, fs, notch_freqs, notch_q, zero_phase)
    if filter_type is not None:
        x = frequency_filter(x, fs, filter_type, freqmin, freqmax, order, zero_phase, family)
    return FilterChainResult(data=x, notch_applied=applied, notch_skipped=skipped)


def compute_welch(
    data: np.ndarray,
    fs: float,
    nperseg: int = 8192,
    overlap: float = 0.5,
) -> Tuple[np.ndarray, np.ndarray]:
    """Calcula densidade espectral de potencia pelo metodo de Welch (janela Hann)."""
    x = data.astype(np.float64)
    x = x - np.mean(x)
    nperseg = int(min(nperseg, len(x)))
    noverlap = int(nperseg * overlap)
    freqs, psd = welch(x, fs=fs, window="hann", nperseg=nperseg, noverlap=noverlap, detrend="constant")
    return freqs, psd


def effective_bands(bands: Sequence[Tuple[float, float]], fs: float) -> List[Tuple[float, float]]:
    """Remove bandas acima de Nyquist e limita a frequencia superior a Nyquist."""
    nyquist = 0.5 * fs
    result = []
    for fmin, fmax in bands:
        if fmin >= nyquist:
            continue
        result.append((float(fmin), float(min(fmax, nyquist))))
    return result


def band_energy_table(
    freqs: np.ndarray,
    psd_raw: np.ndarray,
    psd_processed: np.ndarray,
    bands: Sequence[Tuple[float, float]],
) -> pd.DataFrame:
    """Integra a PSD em cada banda (potencia na banda) e calcula a fracao do total."""
    total_raw = float(np.trapezoid(psd_raw, freqs))
    total_processed = float(np.trapezoid(psd_processed, freqs))
    rows = []
    for fmin, fmax in bands:
        mask = (freqs >= fmin) & (freqs <= fmax)
        if np.count_nonzero(mask) >= 2:
            energy_raw = float(np.trapezoid(psd_raw[mask], freqs[mask]))
            energy_processed = float(np.trapezoid(psd_processed[mask], freqs[mask]))
        else:
            energy_raw = energy_processed = float("nan")
        rows.append(
            {
                "band_hz": f"{fmin:g}-{fmax:g}",
                "fmin_hz": fmin,
                "fmax_hz": fmax,
                "energy_raw": energy_raw,
                "energy_processed": energy_processed,
                "percent_raw": 100.0 * energy_raw / total_raw if total_raw > 0 else float("nan"),
                "percent_processed": 100.0 * energy_processed / total_processed if total_processed > 0 else float("nan"),
            }
        )
    return pd.DataFrame(rows, columns=BAND_COLUMNS)


def dominant_frequency(segment: np.ndarray, fs: float) -> float:
    """Frequencia de maior amplitude espectral (excluindo DC) de um trecho curto."""
    if len(segment) < 8:
        return float("nan")
    x = (segment - np.mean(segment)) * np.hanning(len(segment))
    nfft = max(256, 1 << int(np.ceil(np.log2(len(x)))))
    spectrum = np.abs(np.fft.rfft(x, n=nfft))
    freqs = np.fft.rfftfreq(nfft, d=1.0 / fs)
    return float(freqs[1 + int(np.argmax(spectrum[1:]))])


def sta_lta_samples(fs: float, sta_s: float, lta_s: float) -> Tuple[int, int]:
    """Tamanhos das janelas STA e LTA em amostras (LTA sempre maior que STA)."""
    nsta = max(1, int(round(sta_s * fs)))
    return nsta, max(nsta + 1, int(round(lta_s * fs)))


def compute_sta_lta(
    data: np.ndarray,
    fs: float,
    sta_s: float,
    lta_s: float,
    method: str = "classic",
) -> Tuple[np.ndarray, int, int]:
    """Funcao caracteristica STA/LTA (classica ou recursiva) e tamanhos das janelas em amostras."""
    nsta, nlta = sta_lta_samples(fs, sta_s, lta_s)
    x = data.astype(np.float64)
    if len(x) <= nlta:
        return np.zeros(len(x)), nsta, nlta
    if method == "recursive":
        return recursive_sta_lta(x, nsta, nlta), nsta, nlta
    return classic_sta_lta(x, nsta, nlta), nsta, nlta


def detect_sta_lta_events(
    data: np.ndarray,
    fs: float,
    starttime: UTCDateTime,
    sta_s: float = 0.5,
    lta_s: float = 5.0,
    trigger_on: float = 8.0,
    trigger_off: float = 2.0,
    max_len_s: float = 5.0,
    method: str = "classic",
    min_duration_s: float = 0.0,
    filled_mask: Optional[np.ndarray] = None,
    edge_samples: int = 0,
    low_snr_threshold: Optional[float] = None,
    min_snr: float = 0.0,
) -> Tuple[pd.DataFrame, np.ndarray]:
    """
    Detecta eventos candidatos usando STA/LTA.

    Para cada candidato sao calculados: SNR (RMS do evento / RMS da janela LTA anterior),
    frequencia dominante, instante do pico e flags de QC ('gap' quando a janela toca
    amostras preenchidas; 'edge' quando cai na regiao do taper; 'low_snr' quando o SNR
    fica abaixo de `low_snr_threshold`, se informado). Candidatos com SNR < `min_snr` sao
    descartados; sem janela de ruido (SNR indefinido) o candidato e mantido. Os eventos
    sao numerados em ordem cronologica e ordenados por max_sta_lta decrescente.
    """
    cft, _, nlta = compute_sta_lta(data, fs, sta_s, lta_s, method)
    max_len = int(max_len_s * fs) if max_len_s > 0 else 9e99
    on_off = trigger_onset(cft, trigger_on, trigger_off, max_len=max_len, max_len_delete=False)

    rows = []
    discarded_low_snr = 0
    for on, off in on_off:
        on, off = int(on), int(min(max(off, on + 1), len(data) - 1))
        segment = data[on : off + 1]
        duration = (off - on) / fs
        if len(segment) == 0 or duration < min_duration_s:
            continue

        noise = data[max(0, on - nlta) : on]
        noise_rms = float(np.sqrt(np.mean(noise**2))) if noise.size else float("nan")
        rms = float(np.sqrt(np.mean(segment**2)))
        snr = rms / noise_rms if noise_rms > 0 else float("nan")
        if min_snr > 0 and np.isfinite(snr) and snr < min_snr:
            discarded_low_snr += 1
            continue
        peak_index = on + int(np.argmax(np.abs(segment)))

        flags = []
        if filled_mask is not None and np.any(filled_mask[max(0, on - nlta) : off + 1]):
            flags.append("gap")
        if edge_samples and (on < edge_samples or off >= len(data) - edge_samples):
            flags.append("edge")
        if low_snr_threshold is not None and np.isfinite(snr) and snr < low_snr_threshold:
            flags.append("low_snr")

        rows.append(
            {
                "event_id": len(rows) + 1,
                "sample_on": on,
                "sample_off": off,
                "starttime_utc": str(starttime + on / fs),
                "endtime_utc": str(starttime + off / fs),
                "start_seconds_from_beginning": float(on / fs),
                "duration_s": float(duration),
                "max_sta_lta": float(np.max(cft[on : off + 1])),
                "max_abs_amplitude_filtered": float(np.max(np.abs(segment))),
                "rms_filtered": rms,
                "peak_time_utc": str(starttime + peak_index / fs),
                "snr": snr,
                "dominant_frequency_hz": dominant_frequency(segment, fs),
                "qc_flags": ";".join(flags),
            }
        )

    events = pd.DataFrame(rows, columns=EVENT_COLUMNS)
    if not events.empty:
        events = events.sort_values("max_sta_lta", ascending=False, kind="stable").reset_index(drop=True)
    events.attrs["discarded_low_snr"] = discarded_low_snr
    return events, cft


# -----------------------------------------------------------------------------
# Figuras
# -----------------------------------------------------------------------------


def _time_scale(duration_s: float) -> Tuple[float, str]:
    """Escolhe a unidade do eixo de tempo conforme a duracao do registro."""
    if duration_s <= 600:
        return 1.0, "s"
    if duration_s <= 3 * 3600:
        return 60.0, "min"
    return 3600.0, "h"


def _envelope(data: np.ndarray, max_bins: int = 4000) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Envelope min/max por bloco para plotagem de series longas.

    Ao contrario da decimacao simples (x[::step]), preserva picos e spikes.
    """
    n = len(data)
    if n <= 2 * max_bins:
        idx = np.arange(n)
        return idx, data, data
    block = int(np.ceil(n / max_bins))
    n_blocks = int(np.ceil(n / block))
    padded = np.full(n_blocks * block, np.nan)
    padded[:n] = data
    blocks = padded.reshape(n_blocks, block)
    centers = np.minimum(np.arange(n_blocks) * block + block // 2, n - 1)
    return centers, np.nanmin(blocks, axis=1), np.nanmax(blocks, axis=1)


def _plot_series(ax, data: np.ndarray, fs: float, divisor: float, offset_samples: int = 0, **kwargs):
    idx, low, high = _envelope(data)
    t = (idx + offset_samples) / fs / divisor
    if low is high:
        ax.plot(t, data, linewidth=0.7, **kwargs)
    else:
        ax.fill_between(t, low, high, linewidth=0.5, **kwargs)


def _utc_label(starttime: Optional[UTCDateTime]) -> str:
    """'2026-01-01 00:00:00.069 UTC' (milissegundos), para titulos e eixos."""
    if starttime is None:
        return ""
    return starttime.strftime("%Y-%m-%d %H:%M:%S.") + f"{starttime.microsecond // 1000:03d} UTC"


def _time_axis_label(unit: str, starttime: Optional[UTCDateTime]) -> str:
    return f"Tempo desde {_utc_label(starttime)} ({unit})" if starttime is not None else f"Tempo desde o inicio ({unit})"


def _amplitude_axis(ax, label: str) -> None:
    """Rotulo com unidade e numeros em k/M (em vez do deslocamento '1e6' do matplotlib)."""
    ax.set_ylabel(label)
    ax.yaxis.set_major_formatter(EngFormatter(sep=""))


def _mark_events(ax, events: Optional[pd.DataFrame], fs: float, divisor: float) -> None:
    """
    Marca o inicio de cada evento com um triangulo no topo do eixo.

    Eventos duram menos de 1 s: em registros de horas, faixas verticais viram dezenas de
    linhas de altura total que escondem o sinal.
    """
    if events is None or events.empty:
        return
    t = events["sample_on"].to_numpy(dtype=float) / fs / divisor
    ax.plot(
        t,
        np.full(len(t), 0.98),
        "v",
        color="tab:orange",
        markersize=6,
        transform=ax.get_xaxis_transform(),
        clip_on=False,
        label=f"Eventos STA/LTA ({len(t)})",
    )


def _legend_below(ax) -> None:
    """Legenda abaixo do grafico, para nao cobrir dados."""
    handles, labels = ax.get_legend_handles_labels()
    if handles:
        ax.legend(loc="upper center", bbox_to_anchor=(0.5, -0.18), ncol=min(4, len(handles)), frameon=False)


def _save(output_path: Path, dpi: int):
    plt.tight_layout()
    plt.savefig(output_path, dpi=dpi)
    plt.close()


def save_message_plot(output_path: Path, message: str, dpi: int = 150):
    """Gera uma figura informativa (ex.: etapa desativada ou nenhum evento detectado)."""
    plt.figure(figsize=(10, 4))
    plt.text(0.5, 0.5, message, ha="center", va="center", fontsize=14)
    plt.axis("off")
    _save(output_path, dpi)


def save_no_event_plot(output_path: Path, dpi: int = 150):
    """Gera uma figura informativa quando nenhum evento STA/LTA e detectado."""
    save_message_plot(output_path, "Nenhum evento candidato detectado", dpi)


def save_full_day_overview(
    data: np.ndarray,
    fs: float,
    output_path: Path,
    title: str,
    spike_indices: Optional[np.ndarray] = None,
    events: Optional[pd.DataFrame] = None,
    dpi: int = 150,
    despiked: Optional[np.ndarray] = None,
    starttime: Optional[UTCDateTime] = None,
):
    """
    Visao geral do registro inteiro (envelope min/max), com spikes e eventos marcados.

    Com `despiked`, o tracado usa o registro sem spikes: glitches de digitalizador
    (ex.: -2^22 contagens) chegam a milhares de vezes a amplitude do sinal e achatariam
    todo o resto. Spikes fora da escala sao marcados na borda do eixo.
    """
    divisor, unit = _time_scale(len(data) / fs)
    fig, ax = plt.subplots(figsize=(12, 4))
    _plot_series(ax, data if despiked is None else despiked, fs, divisor, color="tab:blue")
    if spike_indices is not None and len(spike_indices):
        low, high = ax.get_ylim()
        t_spikes = spike_indices / fs / divisor
        values = data[spike_indices]
        inside = (values >= low) & (values <= high)
        if inside.any():
            ax.plot(t_spikes[inside], values[inside], "x", color="tab:red", markersize=5, label="Spikes")
        if (~inside).any():
            peak = values[~inside][np.argmax(np.abs(values[~inside]))]
            ax.plot(
                t_spikes[~inside],
                np.where(values[~inside] > high, high, low),
                "d",
                color="tab:red",
                markersize=6,
                clip_on=False,
                label=f"Spikes fora da escala (bruto ate {EngFormatter(places=2, sep='')(peak)})",
            )
        ax.set_ylim(low, high)
    _mark_events(ax, events, fs, divisor)
    ax.set_xlabel(_time_axis_label(unit, starttime))
    _amplitude_axis(ax, "Amplitude (contagens)")
    ax.set_title(title)
    ax.grid(True, alpha=0.3)
    _legend_below(ax)
    _save(output_path, dpi)


def save_window_plot(
    raw: np.ndarray,
    processed: np.ndarray,
    fs: float,
    start_s: float,
    duration_s: float,
    output_path: Path,
    title: str,
    dpi: int = 150,
    starttime: Optional[UTCDateTime] = None,
    taper_samples: int = 0,
    despiked: Optional[np.ndarray] = None,
    spike_indices: Optional[np.ndarray] = None,
):
    """
    Compara uma janela do dado bruto e processado.

    Com `despiked`, a escala do painel bruto segue o sinal sem spikes e os spikes da janela
    sao marcados na borda (um glitch de milhoes de contagens achataria o resto). A regiao
    do taper, quando cai na janela, e sombreada no painel processado.
    """
    i0 = max(0, int(start_s * fs))
    i1 = min(len(raw), len(processed), int((start_s + duration_s) * fs))
    if i1 <= i0:
        raise ValueError("A janela solicitada nao contem amostras.")
    divisor, unit = _time_scale((i1 - i0) / fs)
    window_start = starttime + i0 / fs if starttime is not None else None

    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(12, 6), sharex=True)
    _plot_series(ax1, raw[i0:i1], fs, divisor, color="tab:blue")
    if despiked is not None and spike_indices is not None:
        inside = spike_indices[(spike_indices >= i0) & (spike_indices < i1)]
        if len(inside):
            clean = despiked[i0:i1]
            pad = 0.15 * max(float(np.ptp(clean)), 1.0)
            low, high = float(np.min(clean)) - pad, float(np.max(clean)) + pad
            ax1.set_ylim(low, high)
            values = raw[inside]
            ax1.plot(
                (inside - i0) / fs / divisor,
                np.clip(values, low, high),
                "d",
                color="tab:red",
                markersize=7,
                clip_on=False,
                label=f"Spike (bruto {EngFormatter(places=2, sep='')(values[np.argmax(np.abs(values))])}, fora da escala)",
            )
            ax1.legend(loc="upper right")
    _amplitude_axis(ax1, "Bruto (contagens)")
    ax1.set_title(f"{title} - {_utc_label(window_start)}" if window_start is not None else title)
    ax1.grid(True, alpha=0.3)

    _plot_series(ax2, processed[i0:i1], fs, divisor, color="tab:green")
    if taper_samples:
        n = len(processed)
        for a, b in ((0, taper_samples), (n - taper_samples, n)):
            lo, hi = max(a, i0), min(b, i1)
            if hi > lo:
                ax2.axvspan((lo - i0) / fs / divisor, (hi - i0) / fs / divisor, color="tab:gray", alpha=0.12, label="Taper (bordas suavizadas)")
        if ax2.get_legend_handles_labels()[0]:
            ax2.legend(loc="upper right")
    ax2.set_xlabel(f"Tempo desde {_utc_label(window_start)} ({unit})" if window_start is not None else f"Tempo na janela ({unit})")
    _amplitude_axis(ax2, "Processado (contagens)")
    ax2.grid(True, alpha=0.3)
    _save(output_path, dpi)


def save_psd_plot(
    freqs_raw,
    psd_raw,
    freqs_proc,
    psd_proc,
    output_path: Path,
    band: Optional[Tuple[Optional[float], Optional[float]]] = None,
    dpi: int = 150,
    filter_type: str = "bandpass",
    notch_freqs: Optional[Sequence[float]] = None,
    raw_label: str = "Bruto",
):
    """
    Plota PSD antes e depois do processamento (eixos log-log).

    `band` = (freqmin, freqmax) do filtro de frequencia (None no limite nao usado pelo tipo).
    Destaca a faixa mantida (passa-banda/alta/baixa) ou removida (rejeita-banda) e marca
    cada frequencia de notch com uma linha tracejada.
    """
    valid = freqs_raw > 0
    plt.figure(figsize=(10, 5))
    plt.loglog(freqs_raw[valid], psd_raw[valid], linewidth=0.9, label=raw_label)
    plt.loglog(freqs_proc[valid], psd_proc[valid], linewidth=0.9, label="Processado")
    if band is not None:
        fmin, fmax = band
        f_low, f_high = float(freqs_raw[valid][0]), float(freqs_raw[valid][-1])
        if filter_type == "bandstop":
            plt.axvspan(fmin, fmax, color="tab:red", alpha=0.08, label="Faixa removida")
        else:
            label = {"highpass": "Faixa mantida (passa-alta)", "lowpass": "Faixa mantida (passa-baixa)"}.get(
                filter_type, "Banda do filtro"
            )
            plt.axvspan(fmin if fmin is not None else f_low, fmax if fmax is not None else f_high, color="tab:green", alpha=0.08, label=label)
    for i, f0 in enumerate(notch_freqs or []):
        plt.axvline(f0, color="tab:purple", linestyle="--", linewidth=0.9, label="Notch" if i == 0 else None)
    # Piso do eixo 80 dB abaixo do minimo do bruto: mostra o corte dos filtros sem esticar o
    # grafico ate o piso numerico (~1e-15) da filtragem.
    raw_positive = psd_raw[valid][psd_raw[valid] > 0]
    if raw_positive.size:
        plt.ylim(bottom=float(np.min(raw_positive)) * 1e-8)
    plt.xlabel("Frequencia (Hz)")
    plt.ylabel("PSD (contagens^2/Hz)")
    plt.title("Densidade espectral de potencia - Welch")
    plt.grid(True, which="both", alpha=0.3)
    plt.legend()
    _save(output_path, dpi)


def save_qc_plot(
    qc: pd.DataFrame,
    output_path: Path,
    window_s: float,
    dpi: int = 150,
    starttime: Optional[UTCDateTime] = None,
):
    """
    Plota indicadores de QC por janela. Janelas com spikes sao marcadas (os spikes inflam
    o desvio padrao e o p99 brutos); janelas com gaps ou sinal plano sao destacadas.
    """
    t_s = qc["seconds_from_beginning"].to_numpy()
    divisor, unit = _time_scale(float(t_s[-1] + qc["duration_s"].iloc[-1]) if len(t_s) else 0.0)
    t = t_s / divisor

    fig, ax = plt.subplots(figsize=(12, 5))
    ax.plot(t, qc["std"], linewidth=0.8, label="Desvio padrao")
    ax.plot(t, qc["p99_abs_dev"], linewidth=0.8, label="Percentil 99 |x - media|")
    ax.plot(t, qc["rms_processed"], linewidth=0.8, label="RMS processado (banda do filtro)")
    with_spikes = qc[qc["spike_count"] > 0]
    if not with_spikes.empty:
        ax.plot(
            with_spikes["seconds_from_beginning"] / divisor,
            with_spikes["std"],
            "x",
            color="tab:red",
            markersize=7,
            label="Janela com spike (infla os valores brutos)",
        )
    flagged = qc[(qc["filled_fraction"] > 0) | (qc["flatline"])]
    for i, (_, row) in enumerate(flagged.iterrows()):
        start = row["seconds_from_beginning"] / divisor
        ax.axvspan(start, start + row["duration_s"] / divisor, color="tab:red", alpha=0.15, label="Gap/sinal plano" if i == 0 else None)
    ax.set_xlabel(_time_axis_label(unit, starttime))
    _amplitude_axis(ax, "Amplitude (contagens)")
    ax.set_title(f"Indicadores de energia/ruido por janela de {window_s:g} s")
    ax.grid(True, alpha=0.3)
    _legend_below(ax)
    _save(output_path, dpi)


def save_stalta_plot(
    cft: np.ndarray,
    fs: float,
    output_path: Path,
    trigger_on: float,
    trigger_off: float,
    events: Optional[pd.DataFrame] = None,
    dpi: int = 150,
    starttime: Optional[UTCDateTime] = None,
):
    """Plota a funcao STA/LTA (maximo por bloco), limiares e o inicio dos eventos."""
    divisor, unit = _time_scale(len(cft) / fs)
    idx, _, high = _envelope(cft)
    fig, ax = plt.subplots(figsize=(12, 4))
    ax.plot(idx / fs / divisor, high, linewidth=0.7)
    ax.axhline(trigger_on, color="tab:red", linestyle="--", linewidth=1.0, label=f"trigger_on = {trigger_on:g}")
    ax.axhline(trigger_off, color="tab:gray", linestyle=":", linewidth=1.0, label=f"trigger_off = {trigger_off:g}")
    _mark_events(ax, events, fs, divisor)
    ax.set_xlabel(_time_axis_label(unit, starttime))
    ax.set_ylabel("Razao STA/LTA")
    ax.set_title("Funcao caracteristica STA/LTA (maximo por bloco)")
    ax.grid(True, alpha=0.3)
    _legend_below(ax)
    _save(output_path, dpi)


def save_event_window(data: np.ndarray, fs: float, event_row: pd.Series, output_path: Path, dpi: int = 150, half_window_s: float = 10.0):
    """Plota uma janela em torno do evento candidato de maior STA/LTA."""
    center = int(event_row["sample_on"])
    off = int(event_row["sample_off"])
    half_window = int(half_window_s * fs)
    i0 = max(0, center - half_window)
    i1 = min(len(data), max(center + half_window, off + int(2 * fs)))
    t = (np.arange(i0, i1) - center) / fs

    fig, ax = plt.subplots(figsize=(10, 4.5))
    ax.plot(t, data[i0:i1], linewidth=0.8, label="Sinal filtrado")
    ax.axvline(0, linestyle="--", linewidth=1.0, color="tab:red", label="Inicio detectado")
    ax.axvspan(0, (off - center) / fs, color="tab:orange", alpha=0.25, label="Duracao do evento (trigger_on ate trigger_off)")
    ax.set_xlabel("Tempo relativo ao inicio detectado (s)")
    _amplitude_axis(ax, "Amplitude filtrada (contagens)")
    snr = event_row.get("snr", float("nan"))
    freq = event_row.get("dominant_frequency_hz", float("nan"))
    start = UTCDateTime(event_row["starttime_utc"])
    ax.set_title(
        f"Principal evento candidato - {_utc_label(start)}\n"
        f"STA/LTA {event_row['max_sta_lta']:.1f}, SNR {snr:.1f}, f dominante {freq:.1f} Hz"
    )
    ax.grid(True, alpha=0.3)
    _legend_below(ax)
    _save(output_path, dpi)


def save_spectrogram(
    data: np.ndarray,
    fs: float,
    output_path: Path,
    start_s: float = 0.0,
    duration_s: float = 600.0,
    nperseg: int = 256,
    dpi: int = 150,
    starttime: Optional[UTCDateTime] = None,
    fmax_display: Optional[float] = None,
):
    """
    Calcula e plota espectrograma de uma janela do sinal processado.

    A escala de cor usa percentis (1-99,5) da faixa exibida: fora da banda do filtro a PSD
    cai dezenas de dB e, com a escala min-max, a banda util ficaria toda da mesma cor.
    `fmax_display` limita o eixo de frequencia (padrao: Nyquist).
    """
    i0 = max(0, int(start_s * fs))
    i1 = min(len(data), int((start_s + duration_s) * fs))
    segment = data[i0:i1]
    if len(segment) == 0:
        raise ValueError("A janela solicitada para o espectrograma nao contem amostras.")
    nperseg = int(min(nperseg, len(segment)))
    f, t, sxx = spectrogram(segment, fs=fs, nperseg=nperseg, noverlap=(3 * nperseg) // 4, scaling="density", mode="psd")

    top = min(fs / 2, fmax_display) if fmax_display else fs / 2
    db = 10 * np.log10(sxx + 1e-20)
    shown = db[f <= top]
    vmin, vmax = (np.percentile(shown, [1, 99.5]) if shown.size else (None, None))
    window_start = starttime + i0 / fs if starttime is not None else None

    plt.figure(figsize=(10, 5))
    plt.pcolormesh(t, f, db, shading="auto", vmin=vmin, vmax=vmax)
    plt.ylim(0, top)
    plt.xlabel(f"Tempo desde {_utc_label(window_start)} (s)" if window_start is not None else "Tempo na janela (s)")
    plt.ylabel("Frequencia (Hz)")
    plt.title(f"Espectrograma do sinal processado (segmentos de {nperseg / fs:.2f} s)")
    cb = plt.colorbar()
    cb.set_label("PSD (dB rel. contagens^2/Hz)")
    _save(output_path, dpi)


# -----------------------------------------------------------------------------
# Pipeline
# -----------------------------------------------------------------------------


def software_versions() -> Dict[str, str]:
    return {
        "python": platform.python_version(),
        "obspy": obspy.__version__,
        "numpy": np.__version__,
        "scipy": scipy.__version__,
        "pandas": pd.__version__,
        "matplotlib": matplotlib.__version__,
    }


def run_pipeline(config: ProcessingConfig) -> Dict[str, object]:
    """Executa o pipeline completo e retorna um resumo da execucao."""
    config.validate()
    started = time.perf_counter()
    progress = ProgressReporter(config.progress_file)
    warnings: List[str] = []
    fig_dir, tab_dir = ensure_dirs(Path(config.output_dir))

    def warn(message: str) -> None:
        warnings.append(message)
        print(f"Aviso: {message}")

    try:
        progress.update("read", "Localizando e lendo arquivos MiniSEED")
        files = find_mseed_files(config.data_dir, config.files)
        print(f"Arquivos encontrados: {len(files)}")
        if config.files:
            missing = sorted(set(config.files) - {f.name for f in files})
            if missing:
                warn(f"Arquivos solicitados nao encontrados: {missing}")

        file_streams = read_files_by_source(files)
        stream = Stream()
        for _, file_stream in file_streams:
            stream += file_stream
        if len(stream) == 0:
            raise RuntimeError("Nenhum Trace foi lido.")
        stream, trace_id = select_trace_id(stream, config.trace_id)
        stream.sort(keys=["starttime"])

        progress.update("qc", "Gerando resumo por arquivo e lista de gaps")
        summary = summarize_files(file_streams, trace_id)
        summary.to_csv(tab_dir / SUMMARY_CSV, index=False)
        gaps_df = gaps_table(stream)
        gaps_df.to_csv(tab_dir / GAPS_CSV, index=False)

        if config.metadata_only:
            result = {"trace_id": trace_id, "files": len(summary), "metadata_only": True}
            progress.done(result)
            print("Concluido (somente metadados).")
            return result

        print("Compilando registro continuo...")
        record = build_continuous_record(stream, gap_fill=config.gap_fill)
        fs = record.fs
        nyquist = 0.5 * fs
        data_raw = record.data
        starttime = record.starttime
        filled_samples = int(np.count_nonzero(record.filled))
        if filled_samples:
            warn(f"{filled_samples} amostras preenchidas em gaps (metodo '{config.gap_fill}').")
        if record.overlap_samples:
            n_overlaps = int((gaps_df["type"] == "overlap").sum()) if not gaps_df.empty else 0
            warn(
                f"{n_overlaps} overlap(s) entre arquivos: {record.overlap_samples} amostra(s) gravadas em dobro; "
                "prevaleceram as do arquivo posterior."
            )
        if record.timing_inserted or record.timing_dropped:
            accumulated_s = record.clock_drift_ppm * 1e-6 * len(data_raw) / fs
            warn(
                f"Deriva de tempo entre arquivos contiguos: {record.clock_drift_ppm:+.2f} ppm "
                f"({accumulated_s:+.3f} s acumulados; taxa efetiva {record.effective_sampling_rate:.5f} Hz). "
                f"Para manter o tempo absoluto dos cabecalhos, {record.timing_inserted} amostra(s) foram "
                f"interpoladas e {record.timing_dropped} descartada(s) nas fronteiras. Nao sao gaps de dados."
            )
        uses_min, uses_max = filter_uses(config.filter_type)
        if config.bandpass and uses_min and config.freqmin >= nyquist:
            raise ValueError(f"freqmin ({config.freqmin} Hz) deve ser menor que Nyquist ({nyquist} Hz).")

        raw_median, raw_mad, _ = _robust_sigma(data_raw)

        progress.update("despike", "Identificando e interpolando spikes")
        if config.despike:
            if config.spike_method == "residual":
                spike_mask, _, _ = residual_spike_mask(
                    data_raw, config.spike_z, window=config.spike_window, max_width=config.spike_max_width
                )
            else:
                spike_mask, _, _ = robust_spike_mask(data_raw, z_threshold=config.spike_z)
            spike_mask &= ~record.filled
            data_despiked = replace_spikes_by_interpolation(data_raw, spike_mask)
        else:
            spike_mask = np.zeros(len(data_raw), dtype=bool)
            data_despiked = data_raw
        spike_indices = np.flatnonzero(spike_mask)
        spike_ids = label_runs(spike_mask)

        progress.update("preprocess", "Pre-processamento: remocao da media, detrend linear e taper")
        n_taper = taper_length(len(data_raw), fs, config.taper_seconds, config.taper_max_fraction) if config.taper else 0
        if config.taper and n_taper < int(config.taper_seconds * fs):
            warn(f"Taper limitado a {n_taper / fs:.1f} s por borda ({config.taper_max_fraction:.0%} do registro).")
        x = preprocess_signal(
            data_despiked,
            fs=fs,
            taper_seconds=config.taper_seconds,
            demean=config.demean,
            detrend=config.detrend,
            taper=config.taper,
            taper_max_fraction=config.taper_max_fraction,
        )

        # A chave de progresso continua "bandpass" porque a interface depende dela.
        progress.update("bandpass", "Filtragem (notch + filtro de frequencia)")
        freqmax_eff = effective_freqmax(fs, config.freqmax)
        if config.bandpass and uses_max and freqmax_eff != config.freqmax:
            warn(f"freqmax {config.freqmax} Hz >= Nyquist; usado {freqmax_eff:g} Hz.")
        chain = apply_filter_chain(
            x,
            fs,
            filter_type=config.filter_type if config.bandpass else None,
            freqmin=config.freqmin,
            freqmax=freqmax_eff,
            order=config.filter_order,
            zero_phase=config.zero_phase,
            family=config.filter_family,
            notch_freqs=config.notch_freqs if config.notch else None,
            notch_q=config.notch_q,
        )
        if chain.notch_skipped:
            skipped = ", ".join(f"{f:g}" for f in chain.notch_skipped)
            warn(f"Notch ignorado em {skipped} Hz: frequencia >= Nyquist ({nyquist:g} Hz).")
        data_processed = chain.data

        progress.update("psd", "Analise espectral")
        psd_raw_label = "Bruto (sem spikes)" if len(spike_indices) else "Bruto"
        if config.psd:
            nperseg = int(min(config.welch_nperseg, len(data_raw)))
            if nperseg < config.welch_nperseg:
                warn(f"welch_nperseg reduzido para {nperseg} (registro mais curto que o segmento).")
            # "Bruto" sem os spikes: um glitch de milhoes de contagens tem espectro plano e
            # domina a PSD bruta em quase todas as frequencias (ate 10^4 vezes neste tipo de dado).
            freqs, psd_raw = compute_welch(data_despiked, fs, nperseg, config.welch_overlap)
            _, psd_proc = compute_welch(data_processed, fs, nperseg, config.welch_overlap)
            psd_df = pd.DataFrame({"frequency_hz": freqs, "psd_raw": psd_raw, "psd_processed": psd_proc})
            bands = effective_bands(config.bands, fs)
            if len(bands) != len(config.bands) or any(b[1] != o[1] for b, o in zip(bands, config.bands)):
                warn(f"Bandas de energia ajustadas ao Nyquist ({nyquist:g} Hz).")
            bands_df = band_energy_table(freqs, psd_raw, psd_proc, bands)
        else:
            psd_df = pd.DataFrame(columns=PSD_COLUMNS)
            bands_df = pd.DataFrame(columns=BAND_COLUMNS)

        progress.update("stalta", "Deteccao STA/LTA")
        if config.stalta:
            events, cft = detect_sta_lta_events(
                data_processed,
                fs,
                starttime,
                sta_s=config.sta,
                lta_s=config.lta,
                trigger_on=config.trigger_on,
                trigger_off=config.trigger_off,
                max_len_s=config.max_event_seconds,
                method=config.stalta_method,
                min_duration_s=config.min_event_seconds,
                filled_mask=record.filled,
                edge_samples=n_taper,
                low_snr_threshold=config.low_snr_threshold if config.low_snr_flag else None,
                min_snr=config.min_event_snr,
            )
        else:
            events, cft = pd.DataFrame(columns=EVENT_COLUMNS), None
        low_snr_events = int(events["qc_flags"].fillna("").str.contains("low_snr").sum()) if not events.empty else 0
        discarded_low_snr = int(events.attrs.get("discarded_low_snr", 0))

        qc_df = window_qc_table(data_raw, data_processed, fs, starttime, config.qc_window_seconds, spike_mask, record.filled)

        progress.update("figures", "Gerando figuras")
        dpi = config.figure_dpi
        save_full_day_overview(
            data_raw,
            fs,
            fig_dir / FIG_OVERVIEW,
            f"Visao geral do registro bruto (sem spikes) - {trace_id}" if len(spike_indices) else f"Visao geral do registro bruto - {trace_id}",
            spike_indices,
            events,
            dpi,
            despiked=data_despiked,
            starttime=starttime,
        )
        save_qc_plot(qc_df, fig_dir / FIG_QC, config.qc_window_seconds, dpi, starttime=starttime)
        if config.psd:
            band = (config.freqmin if uses_min else None, freqmax_eff if uses_max else None) if config.bandpass else None
            save_psd_plot(
                freqs,
                psd_raw,
                freqs,
                psd_proc,
                fig_dir / FIG_PSD,
                band,
                dpi,
                filter_type=config.filter_type,
                notch_freqs=chain.notch_applied,
                raw_label=psd_raw_label,
            )
        else:
            save_message_plot(fig_dir / FIG_PSD, "Etapa PSD Welch desativada", dpi)

        window_start = config.window_start
        if window_start * fs >= len(data_raw):
            warn(f"window_start ({window_start} s) alem do fim do registro; usado 0 s.")
            window_start = 0.0
        save_window_plot(
            data_raw,
            data_processed,
            fs,
            window_start,
            config.window_seconds,
            fig_dir / FIG_WINDOW,
            "Janela - bruto vs processado",
            dpi,
            starttime=starttime,
            taper_samples=n_taper,
            despiked=data_despiked,
            spike_indices=spike_indices,
        )
        if config.spectrogram:
            # Sinal filtrado: mostra a banda do filtro com folga (ou ate Nyquist sem limite superior).
            spectrogram_top = 1.5 * freqmax_eff if config.bandpass and uses_max else None
            save_spectrogram(
                data_processed,
                fs,
                fig_dir / FIG_SPECTROGRAM,
                window_start,
                config.window_seconds,
                config.spectrogram_nperseg,
                dpi,
                starttime=starttime,
                fmax_display=spectrogram_top,
            )
        else:
            save_message_plot(fig_dir / FIG_SPECTROGRAM, "Etapa espectrograma desativada", dpi)

        if len(spike_indices) > 0:
            largest = spike_indices[np.argmax(np.abs(data_raw[spike_indices] - raw_median))]
            spike_start_s = max(0.0, float(largest / fs) - 5.0)
            save_window_plot(
                data_raw,
                data_processed,
                fs,
                spike_start_s,
                20,
                fig_dir / FIG_SPIKE,
                "Janela com spike - bruto vs processado",
                dpi,
                starttime=starttime,
                taper_samples=n_taper,
                despiked=data_despiked,
                spike_indices=spike_indices,
            )
        else:
            message = "Nenhum spike detectado" if config.despike else "Etapa de spikes desativada"
            save_message_plot(fig_dir / FIG_SPIKE, message, dpi)

        if cft is not None:
            save_stalta_plot(cft, fs, fig_dir / FIG_STALTA, config.trigger_on, config.trigger_off, events, dpi, starttime=starttime)
        else:
            save_message_plot(fig_dir / FIG_STALTA, "Etapa STA/LTA desativada", dpi)

        if not events.empty:
            save_event_window(data_processed, fs, events.iloc[0], fig_dir / FIG_EVENT, dpi)
        elif config.stalta:
            save_no_event_plot(fig_dir / FIG_EVENT, dpi)
        else:
            save_message_plot(fig_dir / FIG_EVENT, "Etapa STA/LTA desativada", dpi)

        progress.update("export", "Exportando tabelas e parametros")
        active_steps = [
            name
            for name, enabled in (
                ("despike", config.despike),
                ("demean", config.demean),
                ("linear_detrend", config.detrend),
                ("cosine_taper", config.taper),
                ("notch", bool(chain.notch_applied)),
                (config.filter_type, config.bandpass),
            )
            if enabled
        ]
        gap_types = gaps_df["type"] if not gaps_df.empty else pd.Series(dtype=str)
        global_stats = {
            "trace_id": trace_id,
            "starttime_utc": str(starttime),
            "endtime_utc": str(record.endtime),
            "duration_s": float(len(data_raw) / fs),
            "sampling_rate_hz": fs,
            "npts": int(len(data_raw)),
            "min": float(np.min(data_raw)),
            "max": float(np.max(data_raw)),
            "mean": float(np.mean(data_raw)),
            "std": float(np.std(data_raw)),
            # Spikes de milhoes de contagens inflam o desvio padrao bruto.
            "std_despiked": float(np.std(data_despiked)),
            "median": raw_median,
            "mad": raw_mad,
            "p01": float(np.percentile(data_raw, 1)),
            "p99": float(np.percentile(data_raw, 99)),
            "number_of_gaps": int((gap_types == "gap").sum()),
            "number_of_overlaps": int((gap_types == "overlap").sum()),
            "filled_samples": filled_samples,
            "timing_inserted_samples": record.timing_inserted,
            "timing_dropped_samples": record.timing_dropped,
            "clock_drift_ppm": record.clock_drift_ppm,
            "effective_sampling_rate_hz": record.effective_sampling_rate,
            "gap_fill": config.gap_fill,
            "spike_method": config.spike_method if config.despike else "none",
            "spike_threshold_robust_z": float(config.spike_z),
            "spikes_detected": int(len(spike_indices)),
            "spike_clusters": int(spike_ids.max()) if len(spike_ids) else 0,
            "preprocessing": " + ".join(active_steps) if active_steps else "none",
            "taper_seconds": float(n_taper / fs),
            "filter_type": config.filter_type if config.bandpass else "none",
            "filter_family": config.filter_family,
            "freqmin_hz": float(config.freqmin) if config.bandpass and uses_min else float("nan"),
            "freqmax_hz": float(freqmax_eff) if config.bandpass and uses_max else float("nan"),
            "filter_order": int(config.filter_order),
            "notch_freqs_hz": ";".join(f"{f:g}" for f in chain.notch_applied),
            "notch_q": float(config.notch_q) if chain.notch_applied else float("nan"),
            "zero_phase": bool(config.zero_phase),
            "stalta_method": config.stalta_method if config.stalta else "none",
            "sta_s": float(config.sta),
            "lta_s": float(config.lta),
            "trigger_on": float(config.trigger_on),
            "trigger_off": float(config.trigger_off),
            "events_detected": int(len(events)),
            "low_snr_threshold": float(config.low_snr_threshold) if config.low_snr_flag else float("nan"),
            "events_low_snr": low_snr_events,
            "min_event_snr": float(config.min_event_snr),
            "events_discarded_low_snr": discarded_low_snr,
            "psd_raw_source": ("despiked" if len(spike_indices) else "raw") if config.psd else "none",
        }
        pd.DataFrame([global_stats]).to_csv(tab_dir / GLOBAL_CSV, index=False)

        spikes_df = pd.DataFrame(
            {
                "sample": spike_indices,
                "time_utc": [str(starttime + i / fs) for i in spike_indices],
                "seconds_from_beginning": spike_indices / fs,
                "raw_amplitude": data_raw[spike_indices],
                "spike_id": spike_ids[spike_indices],
            },
            columns=SPIKE_COLUMNS,
        )
        spikes_df.to_csv(tab_dir / SPIKES_CSV, index=False)
        psd_df.to_csv(tab_dir / PSD_CSV, index=False)
        bands_df.to_csv(tab_dir / BANDS_CSV, index=False)
        events.to_csv(tab_dir / EVENTS_CSV, index=False)
        qc_df.to_csv(tab_dir / QC_WINDOWS_CSV, index=False)

        runtime_s = time.perf_counter() - started
        result = {
            "trace_id": trace_id,
            "files": len(summary),
            "sampling_rate_hz": fs,
            "duration_s": float(len(data_raw) / fs),
            "spikes_detected": int(len(spike_indices)),
            "events_detected": int(len(events)),
            "runtime_s": round(runtime_s, 3),
        }
        config_dict = asdict(config)
        config_dict["bands"] = [list(b) for b in config.bands]
        metadata = {
            "generated_at_utc": datetime.now(timezone.utc).isoformat(),
            "software": software_versions(),
            "input": {"files": [f.name for f, _ in file_streams], "trace_id": trace_id},
            "parameters": config_dict,
            "effective": {
                "sampling_rate_hz": fs,
                "effective_sampling_rate_hz": record.effective_sampling_rate,
                "clock_drift_ppm": record.clock_drift_ppm,
                "nyquist_hz": nyquist,
                "freqmax_hz": freqmax_eff,
                "filter_type": config.filter_type if config.bandpass else "none",
                "notch_freqs_applied_hz": chain.notch_applied,
                "notch_freqs_skipped_hz": chain.notch_skipped,
                "taper_samples_per_edge": n_taper,
                "welch_nperseg": int(min(config.welch_nperseg, len(data_raw))),
                "bands_hz": [list(b) for b in effective_bands(config.bands, fs)],
                "sta_lta_samples": list(sta_lta_samples(fs, config.sta, config.lta)),
                "low_snr_threshold": config.low_snr_threshold if config.low_snr_flag else None,
                "events_low_snr": low_snr_events,
                "events_discarded_low_snr": discarded_low_snr,
            },
            "warnings": warnings,
            "result": result,
        }
        (tab_dir / PARAMS_JSON).write_text(json.dumps(metadata, indent=2, default=str), encoding="utf-8")

        progress.done(result)
        print("Concluido.")
        print(f"Trace analisado: {trace_id}")
        print(f"Taxa de amostragem: {fs} Hz")
        print(f"Duracao: {len(data_raw) / fs:.1f} s")
        print(f"Spikes detectados: {len(spike_indices)}")
        print(f"Eventos candidatos STA/LTA: {len(events)}")
        print(f"Tempo de execucao: {runtime_s:.1f} s")
        print(f"Resultados salvos em: {config.output_dir}")
        return result
    except Exception as exc:
        progress.fail(str(exc))
        raise


# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    defaults = ProcessingConfig(data_dir=Path("."))
    toggle = argparse.BooleanOptionalAction
    parser = argparse.ArgumentParser(
        description="Analise de dados microssismicos MiniSEED.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )

    io = parser.add_argument_group("Entrada e saida")
    io.add_argument("--data-dir", type=Path, required=True, help="Diretorio com os arquivos MiniSEED.")
    io.add_argument("--output-dir", type=Path, default=defaults.output_dir, help="Diretorio de saida.")
    io.add_argument("--files", nargs="+", metavar="NOME", help="Processa somente estes arquivos (nome, sem caminho).")
    io.add_argument("--trace-id", help="Id NET.STA.LOC.CHA a processar (aceita * e ?). Necessario com varios canais.")
    io.add_argument("--metadata-only", action="store_true", help="Gera apenas o resumo por arquivo e a lista de gaps.")
    io.add_argument("--progress-file", type=Path, help="Arquivo JSON atualizado com o andamento do pipeline.")
    io.add_argument("--figure-dpi", type=int, default=defaults.figure_dpi, help="Resolucao das figuras PNG.")

    qc = parser.add_argument_group("Controle de qualidade")
    qc.add_argument("--gap-fill", choices=GAP_FILL_METHODS, default=defaults.gap_fill, help="Preenchimento de gaps no registro continuo.")
    qc.add_argument("--qc-window-seconds", type=float, default=defaults.qc_window_seconds, help="Janela dos indicadores de QC (s).")

    sp = parser.add_argument_group("Spikes")
    sp.add_argument("--despike", action=toggle, default=defaults.despike, help="Detectar e interpolar spikes.")
    sp.add_argument("--spike-method", choices=SPIKE_METHODS, default=defaults.spike_method, help="'residual' (mediana movel) ou 'global' (legado).")
    sp.add_argument("--spike-z", type=float, default=defaults.spike_z, help="Limiar de z-score robusto para spikes.")
    sp.add_argument("--spike-window", type=int, default=defaults.spike_window, help="Janela da mediana movel (amostras, impar).")
    sp.add_argument("--spike-max-width", type=int, default=defaults.spike_max_width, help="Largura maxima de um spike (amostras).")

    pre = parser.add_argument_group("Pre-processamento e filtro")
    pre.add_argument("--demean", action=toggle, default=defaults.demean, help="Remover a media.")
    pre.add_argument("--detrend", action=toggle, default=defaults.detrend, help="Remover tendencia linear.")
    pre.add_argument("--taper", action=toggle, default=defaults.taper, help="Aplicar taper cosseno nas bordas.")
    pre.add_argument("--taper-seconds", type=float, default=defaults.taper_seconds, help="Duracao do taper cosseno aplicado nas bordas, em segundos.")
    pre.add_argument("--taper-max-fraction", type=float, default=defaults.taper_max_fraction, help="Fracao maxima do registro afetada pelo taper em cada borda.")
    pre.add_argument("--bandpass", action=toggle, default=defaults.bandpass, help="Aplicar o filtro de frequencia (tipo em --filter-type).")
    pre.add_argument("--filter-type", choices=FILTER_TYPES, default=defaults.filter_type, help="Tipo do filtro de frequencia.")
    pre.add_argument("--filter-family", choices=FILTER_FAMILIES, default=defaults.filter_family, help="Familia do filtro (formato do corte).")
    pre.add_argument("--freqmin", type=float, default=defaults.freqmin, help="Corte inferior (bandpass/highpass) ou inicio da faixa removida (bandstop), em Hz.")
    pre.add_argument("--freqmax", type=float, default=defaults.freqmax, help="Corte superior (bandpass/lowpass) ou fim da faixa removida (bandstop), em Hz; limitada a 95%% de Nyquist.")
    pre.add_argument("--filter-order", type=int, default=defaults.filter_order, help="Ordem do filtro (por passagem).")
    pre.add_argument("--zero-phase", action=toggle, default=defaults.zero_phase, help="Filtragem de fase zero (ida e volta).")
    pre.add_argument("--notch", action=toggle, default=defaults.notch, help="Remover frequencias isoladas (notch) antes do filtro de frequencia.")
    pre.add_argument("--notch-freqs", type=parse_frequency_list, default=defaults.notch_freqs, help="Frequencias do notch em Hz, ex.: '60,29'.")
    pre.add_argument("--notch-q", type=float, default=defaults.notch_q, help="Fator de qualidade do notch (largura do corte = f0/Q).")

    spec = parser.add_argument_group("Analise espectral")
    spec.add_argument("--psd", action=toggle, default=defaults.psd, help="Calcular PSD Welch e energia por banda.")
    spec.add_argument("--welch-nperseg", type=int, default=defaults.welch_nperseg, help="Amostras por segmento de Welch.")
    spec.add_argument("--welch-overlap", type=float, default=defaults.welch_overlap, help="Sobreposicao entre segmentos de Welch (0-1).")
    spec.add_argument("--bands", type=parse_bands, default=defaults.bands, help="Bandas de energia, ex.: '0.1-1,1-5,5-10'.")
    spec.add_argument("--spectrogram", action=toggle, default=defaults.spectrogram, help="Gerar espectrograma.")
    spec.add_argument("--spectrogram-nperseg", type=int, default=defaults.spectrogram_nperseg, help="Amostras por janela do espectrograma.")
    spec.add_argument("--window-start", type=float, default=defaults.window_start, help="Inicio da janela de detalhe e do espectrograma (s).")
    spec.add_argument("--window-seconds", type=float, default=defaults.window_seconds, help="Duracao da janela de detalhe e do espectrograma (s).")

    trig = parser.add_argument_group("STA/LTA")
    trig.add_argument("--stalta", action=toggle, default=defaults.stalta, help="Executar deteccao STA/LTA.")
    trig.add_argument("--stalta-method", choices=STALTA_METHODS, default=defaults.stalta_method, help="STA/LTA classico ou recursivo.")
    trig.add_argument("--sta", type=float, default=defaults.sta, help="Janela STA em segundos.")
    trig.add_argument("--lta", type=float, default=defaults.lta, help="Janela LTA em segundos.")
    trig.add_argument("--trigger-on", type=float, default=defaults.trigger_on, help="Limiar de ativacao STA/LTA.")
    trig.add_argument("--trigger-off", type=float, default=defaults.trigger_off, help="Limiar de desativacao STA/LTA.")
    trig.add_argument("--max-event-seconds", type=float, default=defaults.max_event_seconds, help="Duracao maxima de um trigger (0 = sem limite).")
    trig.add_argument("--min-event-seconds", type=float, default=defaults.min_event_seconds, help="Descarta triggers mais curtos que este valor (s).")
    trig.add_argument("--low-snr-flag", action=toggle, default=defaults.low_snr_flag, help="Marcar com a flag 'low_snr' os eventos com SNR abaixo do limiar.")
    trig.add_argument("--low-snr-threshold", type=float, default=defaults.low_snr_threshold, help="Limiar de SNR da flag 'low_snr'.")
    trig.add_argument("--min-event-snr", type=float, default=defaults.min_event_snr, help="Descarta eventos com SNR abaixo deste valor (0 = nao descarta).")
    return parser


def config_from_args(args: argparse.Namespace) -> ProcessingConfig:
    values = vars(args).copy()
    return ProcessingConfig(**values)


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        config = config_from_args(args)
        config.validate()
    except ValueError as exc:
        parser.error(str(exc))

    try:
        run_pipeline(config)
    except (FileNotFoundError, ValueError, RuntimeError) as exc:
        print(f"Erro: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
