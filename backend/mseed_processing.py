"""
mSEED Navigator waveform processing
Analysis utilities for microseismic waveform data in MiniSEED format.

Autor: Paulo Gabriel Xavier Marques

Purpose:
    Compile, read, visualize, process and analyze microseismic waveform
    records using Python and ObsPy.

Principais etapas:
    1. Leitura dos arquivos MiniSEED;
    2. Controle de qualidade e sumarizacao dos metadados;
    3. Visualizacao de sismogramas;
    4. Analise espectral;
    5. Remocao simples de spikes, detrend, taper e filtragem passa-banda;
    6. Deteccao automatica de eventos candidatos por STA/LTA.

Como executar:
    python backend/mseed_processing.py --data-dir examples/data --output-dir resultados

Dependencias:
    obspy, numpy, scipy, pandas, matplotlib
"""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import List, Tuple

import matplotlib
import numpy as np
import pandas as pd

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from scipy.signal import butter, sosfiltfilt, welch, spectrogram, detrend as scipy_detrend

from obspy import read, Stream, UTCDateTime
from obspy.signal.trigger import classic_sta_lta, trigger_onset


# -----------------------------------------------------------------------------
# Utilidades gerais
# -----------------------------------------------------------------------------


def find_mseed_files(data_dir: Path) -> List[Path]:
    """Localiza arquivos MiniSEED dentro do diretorio de dados."""
    patterns = ["*.mseed", "*.miniseed", "*.MSEED", "*.MINISEED", "*.seed", "*.msd"]
    files: List[Path] = []
    for pattern in patterns:
        files.extend(sorted(data_dir.rglob(pattern)))
    return sorted(files)


def read_files(files: List[Path]) -> Stream:
    """Ler todos os arquivos MiniSEED e retorna um Stream ObsPy."""
    if not files:
        raise FileNotFoundError("Nenhum arquivo MiniSEED encontrado.")

    stream = Stream()
    failed = []
    for file in files:
        try:
            stream += read(str(file))
        except Exception as exc:  # pragma: no cover - apenas seguranca de execucao
            failed.append((str(file), str(exc)))

    if failed:
        print("Arquivos com falha de leitura:")
        for filename, error in failed:
            print(f"  - {filename}: {error}")

    stream.sort(keys=["network", "station", "location", "channel", "starttime"])
    return stream


def stream_to_continuous_trace(stream: Stream):
    """
    Converte o Stream para um unico Trace continuo.

    Para datasets com apenas uma estacao/canal, gera um Trace continuo. Em datasets com
    multiplos canais, esta rotina pode ser adaptada para processar cada Trace
    individualmente.
    """
    ids = sorted(set(tr.id for tr in stream))
    if len(ids) != 1:
        raise ValueError(f"Foram encontrados multiplos canais/ids: {ids}. Processar separadamente.")

    stream_copy = stream.copy()
    stream_copy.sort(keys=["starttime"])
    stream_copy.merge(method=1, fill_value="interpolate")

    if len(stream_copy) != 1:
        raise RuntimeError("Apos merge, o Stream nao resultou em um unico Trace.")

    return stream_copy[0]


def ensure_dirs(output_dir: Path) -> Tuple[Path, Path]:
    fig_dir = output_dir / "figuras"
    tab_dir = output_dir / "tabelas"
    fig_dir.mkdir(parents=True, exist_ok=True)
    tab_dir.mkdir(parents=True, exist_ok=True)
    return fig_dir, tab_dir


# -----------------------------------------------------------------------------
# Controle de qualidade e estatisticas
# -----------------------------------------------------------------------------


def summarize_stream(stream: Stream, files: List[Path]) -> pd.DataFrame:
    """Gera uma tabela de metadados e estatisticas por arquivo/Trace."""
    rows = []
    for file, tr in zip(files, stream):
        data = tr.data.astype(np.float64)
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
                "duration_s": float(tr.stats.endtime - tr.stats.starttime),
                "sampling_rate_hz": float(tr.stats.sampling_rate),
                "npts": int(tr.stats.npts),
                "min": float(np.min(data)),
                "max": float(np.max(data)),
                "mean": float(np.mean(data)),
                "std": float(np.std(data)),
                "p99_abs": float(np.percentile(np.abs(data), 99)),
                "peak_abs": float(np.max(np.abs(data))),
            }
        )
    return pd.DataFrame(rows)


def robust_spike_mask(data: np.ndarray, z_threshold: float = 20.0) -> Tuple[np.ndarray, float, float]:
    """
    Identifica spikes impulsivos por z-score robusto baseado em MAD.

    z_robusto = 0.6745 * |x - mediana| / MAD
    """
    x = data.astype(np.float64)
    median = float(np.median(x))
    mad = float(np.median(np.abs(x - median)))
    if mad == 0:
        return np.zeros_like(x, dtype=bool), median, mad

    robust_z = 0.6745 * np.abs(x - median) / mad
    mask = robust_z > z_threshold
    return mask, median, mad


def replace_spikes_by_interpolation(data: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """Substitui amostras marcadas como spikes por interpolacao linear."""
    x = data.astype(np.float64).copy()
    if not np.any(mask):
        return x

    idx = np.arange(len(x))
    good = ~mask
    x[mask] = np.interp(idx[mask], idx[good], x[good])
    return x


def apply_cosine_taper(data: np.ndarray, fs: float, taper_seconds: float = 30.0) -> np.ndarray:
    """
    Aplica taper cosseno apenas nas bordas do registro.

    O taper reduz artefatos de borda durante filtragem e analise espectral.
    Para registros longos, usa-se um limite em segundos para evitar atenuar
    uma parcela excessiva das 24 horas de aquisicao.
    """
    x = data.astype(np.float64).copy()
    if taper_seconds <= 0:
        return x

    n_taper = int(taper_seconds * fs)
    n_taper = min(n_taper, len(x) // 2)
    if n_taper <= 1:
        return x

    ramp = 0.5 * (1.0 - np.cos(np.linspace(0.0, np.pi, n_taper)))
    x[:n_taper] *= ramp
    x[-n_taper:] *= ramp[::-1]
    return x


def preprocess_signal(data: np.ndarray, fs: float, taper_seconds: float = 30.0) -> np.ndarray:
    """
    Realiza pre-processamento antes da filtragem.

    Etapas:
        1. remocao da media;
        2. remocao de tendencia linear;
        3. taper cosseno limitado as bordas.
    """
    x = data.astype(np.float64)
    x = x - np.mean(x)
    x = scipy_detrend(x, type="linear")
    x = apply_cosine_taper(x, fs=fs, taper_seconds=taper_seconds)
    return x


# -----------------------------------------------------------------------------
# Processamento de sinais
# -----------------------------------------------------------------------------


def bandpass_filter(data: np.ndarray, fs: float, freqmin: float, freqmax: float, order: int = 4) -> np.ndarray:
    """Aplica filtro Butterworth passa-banda com fase zero."""
    nyquist = 0.5 * fs
    if freqmax >= nyquist:
        freqmax = 0.95 * nyquist
    sos = butter(order, [freqmin, freqmax], btype="bandpass", fs=fs, output="sos")
    return sosfiltfilt(sos, data.astype(np.float64))


def compute_welch(data: np.ndarray, fs: float, nperseg: int = 8192) -> Tuple[np.ndarray, np.ndarray]:
    """Calcula densidade espectral de potencia pelo metodo de Welch."""
    x = data.astype(np.float64)
    x = x - np.mean(x)
    freqs, psd = welch(x, fs=fs, nperseg=nperseg, noverlap=nperseg // 2, detrend="constant")
    return freqs, psd


def detect_sta_lta_events(
    data: np.ndarray,
    fs: float,
    starttime: UTCDateTime,
    sta_s: float = 0.5,
    lta_s: float = 5.0,
    trigger_on: float = 8.0,
    trigger_off: float = 2.0,
    max_len_s: float = 5.0,
) -> Tuple[pd.DataFrame, np.ndarray]:
    """Detecta eventos candidatos usando STA/LTA classico."""
    nsta = max(1, int(sta_s * fs))
    nlta = max(nsta + 1, int(lta_s * fs))

    cft = classic_sta_lta(data.astype(np.float64), nsta, nlta)
    on_off = trigger_onset(
        cft,
        trigger_on,
        trigger_off,
        max_len=int(max_len_s * fs),
        max_len_delete=False,
    )

    rows = []
    for event_id, (on, off) in enumerate(on_off, start=1):
        segment = data[on:off]
        if len(segment) == 0:
            continue
        rows.append(
            {
                "event_id": event_id,
                "sample_on": int(on),
                "sample_off": int(off),
                "starttime_utc": str(starttime + on / fs),
                "endtime_utc": str(starttime + off / fs),
                "start_seconds_from_beginning": float(on / fs),
                "duration_s": float((off - on) / fs),
                "max_sta_lta": float(np.max(cft[on:off])),
                "max_abs_amplitude_filtered": float(np.max(np.abs(segment))),
                "rms_filtered": float(np.sqrt(np.mean(segment**2))),
            }
        )

    events = pd.DataFrame(rows)
    if not events.empty:
        events = events.sort_values("max_sta_lta", ascending=False).reset_index(drop=True)
    return events, cft


# -----------------------------------------------------------------------------
# Figuras
# -----------------------------------------------------------------------------


def save_full_day_overview(data: np.ndarray, fs: float, output_path: Path, title: str):
    """Plota visao geral das 24 horas com dados subamostrados para visualizacao."""
    step = int(fs * 10)  # 1 ponto a cada 10 s
    x = np.arange(0, len(data), step) / fs / 3600.0
    y = data[::step]

    plt.figure(figsize=(12, 4))
    plt.plot(x, y, linewidth=0.7)
    plt.xlabel("Tempo desde o inicio (h)")
    plt.ylabel("Amplitude (contagens)")
    plt.title(title)
    plt.grid(True, alpha=0.3)
    plt.tight_layout()
    plt.savefig(output_path, dpi=300)
    plt.close()


def save_window_plot(
    raw: np.ndarray,
    processed: np.ndarray,
    fs: float,
    start_s: float,
    duration_s: float,
    output_path: Path,
    title: str,
):
    """Compara uma janela do dado bruto e processado."""
    i0 = max(0, int(start_s * fs))
    i1 = min(len(raw), len(processed), int((start_s + duration_s) * fs))
    if i1 <= i0:
        raise ValueError("A janela solicitada nao contem amostras.")
    t = np.arange(i0, i1) / fs
    t = t - t[0]

    plt.figure(figsize=(12, 6))

    ax1 = plt.subplot(2, 1, 1)
    ax1.plot(t, raw[i0:i1], linewidth=0.7)
    ax1.set_ylabel("Bruto")
    ax1.set_title(title)
    ax1.grid(True, alpha=0.3)

    ax2 = plt.subplot(2, 1, 2, sharex=ax1)
    ax2.plot(t, processed[i0:i1], linewidth=0.7)
    ax2.set_xlabel("Tempo na janela (s)")
    ax2.set_ylabel("Processado")
    ax2.grid(True, alpha=0.3)

    plt.tight_layout()
    plt.savefig(output_path, dpi=300)
    plt.close()


def save_psd_plot(freqs_raw, psd_raw, freqs_proc, psd_proc, output_path: Path):
    """Plota PSD antes e depois do processamento."""
    plt.figure(figsize=(10, 5))
    plt.semilogy(freqs_raw, psd_raw, linewidth=0.9, label="Bruto")
    plt.semilogy(freqs_proc, psd_proc, linewidth=0.9, label="Processado")
    plt.xlabel("Frequencia (Hz)")
    plt.ylabel("PSD")
    plt.title("Densidade espectral de potencia - Welch")
    plt.xlim(0, min(125, max(freqs_raw)))
    plt.grid(True, alpha=0.3)
    plt.legend()
    plt.tight_layout()
    plt.savefig(output_path, dpi=300)
    plt.close()


def save_rms_peak_plot(summary: pd.DataFrame, output_path: Path):
    """Plota RMS/desvio padrao e pico absoluto por minuto."""
    minute = np.arange(len(summary))
    hours = minute / 60.0

    plt.figure(figsize=(12, 5))
    plt.plot(hours, summary["std"].values, linewidth=0.8, label="Desvio padrao por minuto")
    plt.plot(hours, summary["p99_abs"].values, linewidth=0.8, label="Percentil 99 |amplitude|")
    plt.xlabel("Tempo desde o inicio (h)")
    plt.ylabel("Amplitude (contagens)")
    plt.title("Indicadores de energia/ruido por minuto")
    plt.grid(True, alpha=0.3)
    plt.legend()
    plt.tight_layout()
    plt.savefig(output_path, dpi=300)
    plt.close()


def save_stalta_plot(data: np.ndarray, cft: np.ndarray, fs: float, output_path: Path, max_hours: float = 24.0):
    """Plota a serie STA/LTA ao longo do registro."""
    # Subamostragem somente para plotagem
    step = int(fs * 5)  # 1 ponto a cada 5 s
    nmax = min(len(cft), int(max_hours * 3600 * fs))
    x = np.arange(0, nmax, step) / fs / 3600.0
    y = cft[:nmax:step]

    plt.figure(figsize=(12, 4))
    plt.plot(x, y, linewidth=0.7)
    plt.xlabel("Tempo desde o inicio (h)")
    plt.ylabel("Razao STA/LTA")
    plt.title("Funcao caracteristica STA/LTA")
    plt.grid(True, alpha=0.3)
    plt.tight_layout()
    plt.savefig(output_path, dpi=300)
    plt.close()


def save_event_window(data: np.ndarray, fs: float, event_row: pd.Series, output_path: Path):
    """Plota uma janela em torno do evento candidato de maior STA/LTA."""
    center = int(event_row["sample_on"])
    half_window = int(10 * fs)
    i0 = max(0, center - half_window)
    i1 = min(len(data), center + half_window)
    t = (np.arange(i0, i1) - center) / fs

    plt.figure(figsize=(10, 4))
    plt.plot(t, data[i0:i1], linewidth=0.8)
    plt.axvline(0, linestyle="--", linewidth=1.0, label="Inicio detectado")
    plt.xlabel("Tempo relativo ao inicio detectado (s)")
    plt.ylabel("Amplitude filtrada")
    plt.title("Janela do principal evento candidato")
    plt.grid(True, alpha=0.3)
    plt.legend()
    plt.tight_layout()
    plt.savefig(output_path, dpi=300)
    plt.close()


def save_no_event_plot(output_path: Path):
    """Gera uma figura informativa quando nenhum evento STA/LTA e detectado."""
    plt.figure(figsize=(10, 4))
    plt.text(
        0.5,
        0.5,
        "Nenhum evento candidato detectado",
        ha="center",
        va="center",
        fontsize=14,
    )
    plt.axis("off")
    plt.tight_layout()
    plt.savefig(output_path, dpi=300)
    plt.close()


def save_spectrogram(data: np.ndarray, fs: float, output_path: Path, start_s: float = 0.0, duration_s: float = 600.0):
    """Calcula e plota espectrograma de uma janela do sinal processado."""
    i0 = max(0, int(start_s * fs))
    i1 = min(len(data), int((start_s + duration_s) * fs))
    segment = data[i0:i1]
    if len(segment) == 0:
        raise ValueError("A janela solicitada para o espectrograma nao contem amostras.")
    f, t, sxx = spectrogram(segment, fs=fs, nperseg=1024, noverlap=512, scaling="density", mode="psd")

    plt.figure(figsize=(10, 5))
    plt.pcolormesh(t, f, 10 * np.log10(sxx + 1e-20), shading="auto")
    plt.ylim(0, 80)
    plt.xlabel("Tempo na janela (s)")
    plt.ylabel("Frequencia (Hz)")
    plt.title("Espectrograma do sinal processado")
    cb = plt.colorbar()
    cb.set_label("PSD (dB)")
    plt.tight_layout()
    plt.savefig(output_path, dpi=300)
    plt.close()


# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------


def main():
    parser = argparse.ArgumentParser(description="Analise de dados microssismicos MiniSEED.")
    parser.add_argument("--data-dir", type=Path, required=True, help="Diretorio com os arquivos MiniSEED.")
    parser.add_argument("--output-dir", type=Path, default=Path("resultados"), help="Diretorio de saida.")
    parser.add_argument("--freqmin", type=float, default=1.0, help="Frequencia minima do filtro passa-banda.")
    parser.add_argument("--freqmax", type=float, default=45.0, help="Frequencia maxima do filtro passa-banda.")
    parser.add_argument("--spike-z", type=float, default=20.0, help="Limiar de z-score robusto para spikes.")
    parser.add_argument("--taper-seconds", type=float, default=30.0, help="Duracao do taper cosseno aplicado nas bordas, em segundos.")
    parser.add_argument("--sta", type=float, default=0.5, help="Janela STA em segundos.")
    parser.add_argument("--lta", type=float, default=5.0, help="Janela LTA em segundos.")
    parser.add_argument("--trigger-on", type=float, default=8.0, help="Limiar de ativacao STA/LTA.")
    parser.add_argument("--trigger-off", type=float, default=2.0, help="Limiar de desativacao STA/LTA.")
    args = parser.parse_args()

    fig_dir, tab_dir = ensure_dirs(args.output_dir)

    print("Localizando arquivos MiniSEED...")
    files = find_mseed_files(args.data_dir)
    print(f"Arquivos encontrados: {len(files)}")

    print("Lendo arquivos...")
    stream = read_files(files)
    if len(stream) == 0:
        raise RuntimeError("Nenhum Trace foi lido.")

    print("Gerando resumo por arquivo...")
    summary = summarize_stream(stream, files)
    summary.to_csv(tab_dir / "resumo_por_arquivo.csv", index=False)

    gaps = stream.get_gaps()
    gaps_df = pd.DataFrame(
        gaps,
        columns=["network", "station", "location", "channel", "gap_start", "gap_end", "gap_duration_s", "missing_samples"],
    )
    gaps_df.to_csv(tab_dir / "gaps.csv", index=False)

    print("Compilando registro continuo...")
    # Para datasets com um unico id/canal distribuido em multiplos arquivos,
    # a concatenacao em ordem temporal evita custo desnecessario de merge.
    ids = sorted(set(tr.id for tr in stream))
    if len(ids) != 1:
        raise ValueError(f"Foram encontrados multiplos canais/ids: {ids}. Processar separadamente.")
    stream.sort(keys=["starttime"])
    tr0 = stream[0]
    data_raw = np.concatenate([tr.data.astype(np.float64) for tr in stream])
    fs = float(tr0.stats.sampling_rate)
    starttime = tr0.stats.starttime
    endtime = stream[-1].stats.endtime

    global_stats = {
        "trace_id": tr0.id,
        "starttime_utc": str(starttime),
        "endtime_utc": str(endtime),
        "duration_s": float(len(data_raw) / fs),
        "sampling_rate_hz": fs,
        "npts": int(len(data_raw)),
        "min": float(np.min(data_raw)),
        "max": float(np.max(data_raw)),
        "mean": float(np.mean(data_raw)),
        "std": float(np.std(data_raw)),
        "median": float(np.median(data_raw)),
        "p01": float(np.percentile(data_raw, 1)),
        "p99": float(np.percentile(data_raw, 99)),
        "number_of_gaps": int(len(gaps)),
    }

    print("Identificando e interpolando spikes...")
    spike_mask, median, mad = robust_spike_mask(data_raw, z_threshold=args.spike_z)
    data_despiked = replace_spikes_by_interpolation(data_raw, spike_mask)
    global_stats["median"] = median
    global_stats["mad"] = mad
    global_stats["spike_threshold_robust_z"] = float(args.spike_z)
    global_stats["spikes_detected"] = int(np.sum(spike_mask))
    global_stats["preprocessing"] = "despike + demean + linear_detrend + cosine_taper + bandpass"
    global_stats["taper_seconds"] = float(args.taper_seconds)

    pd.DataFrame([global_stats]).to_csv(tab_dir / "resumo_global.csv", index=False)

    spike_indices = np.where(spike_mask)[0]
    spike_rows = []
    for idx in spike_indices:
        spike_rows.append(
            {
                "sample": int(idx),
                "time_utc": str(starttime + idx / fs),
                "seconds_from_beginning": float(idx / fs),
                "raw_amplitude": float(data_raw[idx]),
            }
        )
    pd.DataFrame(spike_rows).to_csv(tab_dir / "spikes_detectados.csv", index=False)

    print("Pre-processamento: remocao da media, detrend linear, taper e filtragem passa-banda...")
    x = preprocess_signal(data_despiked, fs=fs, taper_seconds=args.taper_seconds)
    data_filtered = bandpass_filter(x, fs, args.freqmin, args.freqmax, order=4)

    print("Analise espectral...")
    freqs_raw, psd_raw = compute_welch(data_raw, fs)
    freqs_filt, psd_filt = compute_welch(data_filtered, fs)

    psd_df = pd.DataFrame({"frequency_hz": freqs_raw, "psd_raw": psd_raw, "psd_processed": psd_filt})
    psd_df.to_csv(tab_dir / "psd_welch.csv", index=False)

    band_rows = []
    for fmin, fmax in [(0.1, 1), (1, 5), (5, 10), (10, 20), (20, 40), (40, 80), (80, 120)]:
        mask = (freqs_raw >= fmin) & (freqs_raw < fmax)
        band_rows.append(
            {
                "band_hz": f"{fmin}-{fmax}",
                "energy_raw": float(np.trapezoid(psd_raw[mask], freqs_raw[mask])),
                "energy_processed": float(np.trapezoid(psd_filt[mask], freqs_filt[mask])),
            }
        )
    pd.DataFrame(band_rows).to_csv(tab_dir / "energia_por_banda.csv", index=False)

    print("Deteccao STA/LTA...")
    events, cft = detect_sta_lta_events(
        data_filtered,
        fs,
        starttime,
        sta_s=args.sta,
        lta_s=args.lta,
        trigger_on=args.trigger_on,
        trigger_off=args.trigger_off,
    )
    events.to_csv(tab_dir / "eventos_candidatos_sta_lta.csv", index=False)

    print("Gerando figuras...")
    save_full_day_overview(data_raw, fs, fig_dir / "visao_geral_24h_bruto.png", f"Visao geral 24 h - {tr0.id}")
    save_rms_peak_plot(summary, fig_dir / "indicadores_por_minuto.png")
    save_psd_plot(freqs_raw, psd_raw, freqs_filt, psd_filt, fig_dir / "psd_bruto_processado.png")

    # Janela inicial e janela em torno do principal evento candidato, se houver.
    save_window_plot(data_raw, data_filtered, fs, 0, 600, fig_dir / "janela_inicial_bruto_processado.png", "Janela inicial - bruto vs processado")
    save_spectrogram(data_filtered, fs, fig_dir / "espectrograma_janela_inicial.png", start_s=0, duration_s=600)

    if len(spike_indices) > 0:
        first_spike_s = max(0.0, float(spike_indices[np.argmax(np.abs(data_raw[spike_indices]))] / fs) - 5.0)
        save_window_plot(data_raw, data_filtered, fs, first_spike_s, 20, fig_dir / "janela_spike_bruto_processado.png", "Janela com spike - bruto vs processado")

    save_stalta_plot(data_filtered, cft, fs, fig_dir / "funcao_sta_lta_24h.png")

    if not events.empty:
        save_event_window(data_filtered, fs, events.iloc[0], fig_dir / "principal_evento_candidato.png")
    else:
        save_no_event_plot(fig_dir / "principal_evento_candidato.png")

    print("Concluido.")
    print(f"Trace analisado: {tr0.id}")
    print(f"Taxa de amostragem: {fs} Hz")
    print(f"Duracao: {len(data_raw) / fs:.1f} s")
    print(f"Spikes detectados: {int(np.sum(spike_mask))}")
    print(f"Eventos candidatos STA/LTA: {len(events)}")
    print(f"Resultados salvos em: {args.output_dir}")


if __name__ == "__main__":
    main()
