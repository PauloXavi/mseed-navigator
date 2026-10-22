from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
from obspy import Stream, Trace, UTCDateTime


ROOT_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT_DIR / "examples" / "data"
sys.path.insert(0, str(ROOT_DIR))

from backend import mseed_processing
from src.server import extract_timeseries


def make_trace(data: np.ndarray, starttime: UTCDateTime, channel: str = "HHZ", sampling_rate: float = 100.0) -> Trace:
    trace = Trace(data=np.asarray(data, dtype=np.int32))
    trace.stats.network = "SY"
    trace.stats.station = "TST01"
    trace.stats.location = "00"
    trace.stats.channel = channel
    trace.stats.sampling_rate = sampling_rate
    trace.stats.starttime = starttime
    return trace


def noise(npts: int, seed: int = 1, scale: float = 1000.0) -> np.ndarray:
    return np.random.default_rng(seed).normal(scale=scale, size=npts)


# -----------------------------------------------------------------------------
# Leitura e metadados
# -----------------------------------------------------------------------------


def test_find_and_read_synthetic_mseed_files() -> None:
    files = mseed_processing.find_mseed_files(DATA_DIR)

    assert len(files) == 3
    assert all(file.name.startswith("synthetic_waveform_") for file in files)

    stream = mseed_processing.read_files(files)

    assert len(stream) == 3
    assert {trace.id for trace in stream} == {"SY.SYN01.00.HHZ"}


def test_find_mseed_files_is_case_insensitive_unique_and_filterable(tmp_path: Path) -> None:
    source = DATA_DIR / "synthetic_waveform_01.mseed"
    shutil.copy(source, tmp_path / "UPPER.MSEED")
    shutil.copy(source, tmp_path / "Mixed.MiniSeed")
    (tmp_path / "notes.txt").write_text("ignore me", encoding="utf-8")

    files = mseed_processing.find_mseed_files(tmp_path)
    assert [file.name for file in files] == ["Mixed.MiniSeed", "UPPER.MSEED"]

    filtered = mseed_processing.find_mseed_files(tmp_path, names=["UPPER.MSEED"])
    assert [file.name for file in filtered] == ["UPPER.MSEED"]


def test_synthetic_trace_metadata_are_preserved() -> None:
    stream = mseed_processing.read_files(mseed_processing.find_mseed_files(DATA_DIR))
    trace = stream[0]

    assert trace.stats.network == "SY"
    assert trace.stats.station == "SYN01"
    assert trace.stats.location == "00"
    assert trace.stats.channel == "HHZ"
    assert float(trace.stats.sampling_rate) == 100.0
    assert int(trace.stats.npts) == 6000
    assert str(trace.stats.starttime) == "2026-01-01T00:00:00.000000Z"


def test_stream_to_continuous_trace_merges_synthetic_segments() -> None:
    stream = mseed_processing.read_files(mseed_processing.find_mseed_files(DATA_DIR))
    trace = mseed_processing.stream_to_continuous_trace(stream)

    assert trace.id == "SY.SYN01.00.HHZ"
    assert int(trace.stats.npts) == 18000
    assert float(trace.stats.sampling_rate) == 100.0
    assert str(trace.stats.starttime) == "2026-01-01T00:00:00.000000Z"


def test_read_files_raises_for_empty_file_list() -> None:
    with pytest.raises(FileNotFoundError, match="Nenhum arquivo MiniSEED encontrado"):
        mseed_processing.read_files([])


def test_invalid_file_is_reported_and_skipped(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    invalid_file = tmp_path / "invalid.mseed"
    invalid_file.write_text("not a miniseed file", encoding="utf-8")

    stream = mseed_processing.read_files([invalid_file])

    assert len(stream) == 0
    captured = capsys.readouterr()
    assert "Arquivos com falha de leitura" in captured.out
    assert "invalid.mseed" in captured.out


def test_summary_rows_keep_correct_file_names(tmp_path: Path) -> None:
    t0 = UTCDateTime("2026-01-01T00:00:00Z")
    # O nome em ordem alfabetica nao coincide com a ordem temporal.
    make_trace(noise(500, 1), t0 + 10).write(str(tmp_path / "a_late.mseed"), format="MSEED")
    make_trace(noise(500, 2), t0).write(str(tmp_path / "b_early.mseed"), format="MSEED")
    (tmp_path / "c_broken.mseed").write_text("broken", encoding="utf-8")

    file_streams = mseed_processing.read_files_by_source(mseed_processing.find_mseed_files(tmp_path))
    summary = mseed_processing.summarize_files(file_streams)

    assert list(summary["arquivo"]) == ["b_early.mseed", "a_late.mseed"]
    assert list(summary["starttime_utc"]) == [str(t0), str(t0 + 10)]


def test_select_trace_id_requires_choice_for_multichannel_data() -> None:
    t0 = UTCDateTime("2026-01-01T00:00:00Z")
    stream = Stream([make_trace(noise(100), t0, "HHZ"), make_trace(noise(100), t0, "HHN")])

    with pytest.raises(ValueError, match="--trace-id"):
        mseed_processing.select_trace_id(stream)

    selected, trace_id = mseed_processing.select_trace_id(stream, "*.HHN")
    assert trace_id == "SY.TST01.00.HHN"
    assert len(selected) == 1


# -----------------------------------------------------------------------------
# Gaps e registro continuo
# -----------------------------------------------------------------------------


def test_continuous_record_keeps_timing_across_gaps() -> None:
    t0 = UTCDateTime("2026-01-01T00:00:00Z")
    first = make_trace(np.full(1000, 10), t0)
    second = make_trace(np.full(1000, 20), t0 + 12.0)  # gap de 2 s (200 amostras)

    record = mseed_processing.build_continuous_record(Stream([second, first]))

    assert len(record.data) == 2200
    assert int(record.filled.sum()) == 200
    assert record.data[1200] == 20  # inicio do segundo trace na posicao temporal correta
    assert 10 < record.data[1100] < 20  # gap preenchido por interpolacao
    assert record.endtime == t0 + 2199 / 100.0

    median_record = mseed_processing.build_continuous_record(Stream([first, second]), gap_fill="median")
    assert np.all(median_record.data[1000:1200] == 15)


def test_continuous_record_rejects_mixed_sampling_rates() -> None:
    t0 = UTCDateTime("2026-01-01T00:00:00Z")
    stream = Stream([make_trace(noise(100), t0), make_trace(noise(100), t0 + 5, sampling_rate=50.0)])

    with pytest.raises(ValueError, match="Taxas de amostragem diferentes"):
        mseed_processing.build_continuous_record(stream)


def test_clock_drift_between_contiguous_files_is_not_reported_as_gap() -> None:
    # 60 arquivos contiguos de 10 s cujos cabecalhos avancam 0,1 amostra a mais por
    # fronteira (+100 ppm), como acontece com relogios de digitalizador que derivam alguns ppm.
    t0 = UTCDateTime("2026-01-01T00:00:00Z")
    fs = 100.0
    traces = [make_trace(np.full(1000, i), t0 + i * (10.0 + 0.1 / fs)) for i in range(60)]

    record = mseed_processing.build_continuous_record(Stream(traces[::-1]))

    assert int(record.filled.sum()) == 0  # nenhum gap real
    assert record.timing_inserted == 6  # 59 fronteiras x 0,1 amostra, arredondado na grade
    assert record.timing_dropped == 0
    assert record.clock_drift_ppm == pytest.approx(100.0, rel=1e-3)
    assert record.effective_sampling_rate == pytest.approx(fs / 1.0001, rel=1e-6)
    # O ultimo arquivo fica na posicao dada pelo seu proprio cabecalho (erro < 0,5 amostra).
    last_offset = int(np.flatnonzero(record.data == 59)[0])
    assert abs(record.starttime + last_offset / fs - traces[-1].stats.starttime) < 0.5 / fs


def test_overlap_keeps_later_segment_and_preserves_grid() -> None:
    t0 = UTCDateTime("2026-01-01T00:00:00Z")
    first = make_trace(np.full(1000, 1), t0)
    second = make_trace(np.full(1000, 2), t0 + 9.0)  # 100 amostras de overlap

    record = mseed_processing.build_continuous_record(Stream([first, second]))

    assert len(record.data) == 1900
    assert record.overlap_samples == 100
    assert record.data[899] == 1 and record.data[900] == 2
    assert not record.filled.any()


def test_read_mseed_file_matches_obspy_read(tmp_path: Path) -> None:
    from obspy import read

    path = DATA_DIR / "synthetic_waveform_01.mseed"
    fast = mseed_processing.read_mseed_file(path)
    reference = read(str(path))

    assert [tr.id for tr in fast] == [tr.id for tr in reference]
    assert fast[0].stats.starttime == reference[0].stats.starttime
    assert np.array_equal(fast[0].data, reference[0].data)

    window = mseed_processing.read_mseed_file(
        path, starttime=reference[0].stats.starttime + 10, endtime=reference[0].stats.starttime + 20
    )
    assert window[0].stats.npts == 1001
    assert mseed_processing.read_mseed_file(path, headonly=True)[0].stats.npts == reference[0].stats.npts


def test_gaps_table_distinguishes_gaps_and_overlaps() -> None:
    t0 = UTCDateTime("2026-01-01T00:00:00Z")
    stream = Stream(
        [
            make_trace(noise(1000, 1), t0),
            make_trace(noise(1000, 2), t0 + 12.0),  # gap
            make_trace(noise(1000, 3), t0 + 21.0),  # overlap com o anterior
        ]
    )

    table = mseed_processing.gaps_table(stream)

    assert list(table["type"]) == ["gap", "overlap"]


# -----------------------------------------------------------------------------
# Spikes, pre-processamento e espectro
# -----------------------------------------------------------------------------


def test_residual_spike_method_flags_glitches_but_keeps_transients() -> None:
    fs = 100.0
    t = np.arange(6000) / fs
    data = noise(len(t), 7, 50.0) + 5e5 * np.exp(-0.5 * ((t - 20.0) / 0.12) ** 2)
    data[3000] += 4e5  # glitch de 1 amostra
    data[4500:4502] -= 3e5  # glitch de 2 amostras

    mask, _, _ = mseed_processing.residual_spike_mask(data, z_threshold=20.0, window=7, max_width=3)
    assert set(np.flatnonzero(mask)) == {3000, 4500, 4501}

    # O metodo legado marca o transiente inteiro como "spike" - motivo da mudanca de padrao.
    legacy_mask, _, _ = mseed_processing.robust_spike_mask(data, z_threshold=20.0)
    assert legacy_mask[1990:2010].any()


def test_spike_interpolation_handles_edge_cases() -> None:
    data = np.array([0.0, 10.0, 2.0, 3.0])
    assert np.allclose(mseed_processing.replace_spikes_by_interpolation(data, np.array([0, 1, 0, 0], bool)), [0, 1, 2, 3])
    all_masked = np.ones(4, dtype=bool)
    assert np.allclose(mseed_processing.replace_spikes_by_interpolation(data, all_masked), data)


def test_taper_is_limited_to_fraction_of_short_records() -> None:
    fs = 100.0
    npts = 18000
    assert mseed_processing.taper_length(npts, fs, taper_seconds=30.0, max_fraction=0.05) == 900
    assert mseed_processing.taper_length(npts, fs, taper_seconds=30.0, max_fraction=None) == 3000

    tapered = mseed_processing.apply_cosine_taper(np.ones(npts), fs, taper_seconds=30.0, max_fraction=0.05)
    assert tapered[0] == 0.0
    assert tapered[900] == 1.0


def test_filter_and_bands_respect_nyquist() -> None:
    assert mseed_processing.effective_freqmax(100.0, 60.0) == pytest.approx(47.5)
    assert mseed_processing.effective_freqmax(100.0, 45.0) == 45.0

    bands = mseed_processing.effective_bands(mseed_processing.DEFAULT_BANDS, 100.0)
    assert bands[-1] == (40.0, 50.0)
    assert all(fmin < 50.0 for fmin, _ in bands)

    with pytest.raises(ValueError, match="Banda do filtro invalida"):
        mseed_processing.bandpass_filter(noise(1000), 100.0, 48.0, 60.0)


def test_causal_filter_has_no_energy_before_impulse() -> None:
    impulse = np.zeros(2000)
    impulse[1000] = 1.0

    causal = mseed_processing.bandpass_filter(impulse, 100.0, 1.0, 20.0, zero_phase=False)
    zero_phase = mseed_processing.bandpass_filter(impulse, 100.0, 1.0, 20.0, zero_phase=True)

    assert np.allclose(causal[:1000], 0.0)
    assert np.abs(zero_phase[900:1000]).max() > 1e-3


def test_band_energy_percentages_sum_to_total() -> None:
    freqs, psd = mseed_processing.compute_welch(noise(20000), 100.0, nperseg=1024)
    table = mseed_processing.band_energy_table(freqs, psd, psd, [(0.0, 25.0), (25.0, 50.0)])

    assert table["percent_raw"].sum() == pytest.approx(100.0, rel=1e-6)


# -----------------------------------------------------------------------------
# Filtros: tipo, familia e notch
# -----------------------------------------------------------------------------


def sine(freq: float, fs: float, seconds: float, amplitude: float = 1.0) -> np.ndarray:
    t = np.arange(int(seconds * fs)) / fs
    return amplitude * np.sin(2 * np.pi * freq * t)


def gain_db(original: np.ndarray, filtered: np.ndarray, trim: float = 0.2) -> float:
    """Ganho RMS em dB, ignorando as bordas (transientes do filtro)."""
    n = len(original)
    core = slice(int(n * trim), int(n * (1 - trim)))
    return 20 * np.log10(np.sqrt(np.mean(filtered[core] ** 2)) / np.sqrt(np.mean(original[core] ** 2)))


def legacy_bandpass(data: np.ndarray, fs: float, freqmin: float, freqmax: float, order: int = 4, zero_phase: bool = True) -> np.ndarray:
    """Copia literal do bandpass_filter anterior aos novos filtros (referencia de regressao)."""
    from scipy.signal import butter, sosfilt, sosfiltfilt

    freqmax = mseed_processing.effective_freqmax(fs, freqmax)
    sos = butter(order, [freqmin, freqmax], btype="bandpass", fs=fs, output="sos")
    x = data.astype(np.float64)
    return sosfiltfilt(sos, x) if zero_phase else sosfilt(sos, x)


def test_highpass_removes_slow_oscillation_and_keeps_10_hz() -> None:
    fs = 100.0
    slow, fast = sine(0.2, fs, 600), sine(10.0, fs, 600)
    kwargs = dict(filter_type="highpass", freqmin=1.0)

    assert gain_db(slow, mseed_processing.frequency_filter(slow, fs, **kwargs)) <= -20.0
    assert abs(gain_db(fast, mseed_processing.frequency_filter(fast, fs, **kwargs))) < 0.5


def test_lowpass_removes_100_hz_and_keeps_10_hz() -> None:
    fs = 500.0
    high, low = sine(100.0, fs, 20), sine(10.0, fs, 20)
    kwargs = dict(filter_type="lowpass", freqmax=45.0)

    assert gain_db(high, mseed_processing.frequency_filter(high, fs, **kwargs)) <= -20.0
    assert abs(gain_db(low, mseed_processing.frequency_filter(low, fs, **kwargs))) < 0.5


def test_bandstop_removes_30_hz_and_keeps_10_hz() -> None:
    fs = 100.0
    inside, outside = sine(30.0, fs, 20), sine(10.0, fs, 20)
    kwargs = dict(filter_type="bandstop", freqmin=25.0, freqmax=35.0)

    assert gain_db(inside, mseed_processing.frequency_filter(inside, fs, **kwargs)) <= -20.0
    assert abs(gain_db(outside, mseed_processing.frequency_filter(outside, fs, **kwargs))) < 0.5


def test_bessel_family_keeps_minus_3_db_at_cutoff_like_butterworth() -> None:
    fs = 250.0
    at_cutoff = sine(20.0, fs, 40)
    # Uma passagem (causal) para medir o ponto de -3 dB do proprio projeto.
    for family in ("butterworth", "bessel"):
        filtered = mseed_processing.frequency_filter(
            at_cutoff, fs, "lowpass", freqmax=20.0, zero_phase=False, family=family
        )
        assert gain_db(at_cutoff, filtered) == pytest.approx(-3.0, abs=0.3)


def test_notch_removes_60_hz_and_keeps_neighbours() -> None:
    fs = 250.0
    hum = sine(60.0, fs, 60)

    filtered, applied, skipped = mseed_processing.notch_filter(hum, fs, [60.0], q=30.0)

    assert applied == [60.0] and skipped == []
    assert gain_db(hum, filtered) <= -30.0
    for neighbour in (50.0, 70.0):
        signal = sine(neighbour, fs, 60)
        assert abs(gain_db(signal, mseed_processing.notch_filter(signal, fs, [60.0], q=30.0)[0])) < 1.0


def test_causal_notch_has_no_energy_before_impulse() -> None:
    impulse = np.zeros(2000)
    impulse[1000] = 1.0

    causal, _, _ = mseed_processing.notch_filter(impulse, 250.0, [60.0], zero_phase=False)

    assert np.allclose(causal[:1000], 0.0)
    assert np.abs(causal[1000:]).max() > 0.5


def test_notch_at_or_above_nyquist_is_skipped() -> None:
    data = noise(1000)

    filtered, applied, skipped = mseed_processing.notch_filter(data, 100.0, [60.0, 25.0])

    assert applied == [25.0]
    assert skipped == [60.0]
    only_high, applied, skipped = mseed_processing.notch_filter(data, 100.0, [50.0])
    assert applied == [] and skipped == [50.0]
    assert np.array_equal(only_high, data)


def test_default_filter_chain_matches_previous_bandpass_exactly() -> None:
    # Regressao: com os padroes (passa-banda 1-45 Hz, Butterworth, ordem 4, notch desligado)
    # o sinal processado precisa ser identico ao da implementacao anterior.
    x = noise(50_000, seed=7)
    defaults = mseed_processing.ProcessingConfig(data_dir=Path("."))

    for zero_phase in (True, False):
        chain = mseed_processing.apply_filter_chain(
            x,
            250.0,
            filter_type=defaults.filter_type,
            freqmin=defaults.freqmin,
            freqmax=defaults.freqmax,
            order=defaults.filter_order,
            zero_phase=zero_phase,
            family=defaults.filter_family,
            notch_freqs=defaults.notch_freqs if defaults.notch else None,
            notch_q=defaults.notch_q,
        )
        assert np.array_equal(chain.data, legacy_bandpass(x, 250.0, 1.0, 45.0, 4, zero_phase))
        assert chain.notch_applied == []
    assert np.array_equal(
        mseed_processing.bandpass_filter(x, 100.0, 1.0, 60.0), legacy_bandpass(x, 100.0, 1.0, 60.0)
    )


def test_default_pipeline_output_matches_previous_filter(tmp_path: Path) -> None:
    # Regressao de ponta a ponta: a PSD processada gravada pelo pipeline com os padroes
    # coincide com a PSD do sinal filtrado pela implementacao anterior.
    config = mseed_processing.ProcessingConfig(data_dir=DATA_DIR, output_dir=tmp_path / "out")
    mseed_processing.run_pipeline(config)
    psd = pd.read_csv(tmp_path / "out" / "tabelas" / "psd_welch.csv")

    record = mseed_processing.build_continuous_record(mseed_processing.read_files(mseed_processing.find_mseed_files(DATA_DIR)))
    mask, _, _ = mseed_processing.residual_spike_mask(record.data, 20.0, window=7, max_width=3)
    despiked = mseed_processing.replace_spikes_by_interpolation(record.data, mask & ~record.filled)
    x = mseed_processing.preprocess_signal(despiked, record.fs, taper_seconds=30.0, taper_max_fraction=0.05)
    expected = legacy_bandpass(x, record.fs, 1.0, 45.0)
    _, expected_psd = mseed_processing.compute_welch(expected, record.fs, min(8192, len(expected)), 0.5)

    assert np.allclose(psd["psd_processed"].to_numpy(), expected_psd, rtol=1e-9, atol=0)


# -----------------------------------------------------------------------------
# STA/LTA
# -----------------------------------------------------------------------------


def test_sta_lta_events_report_snr_frequency_and_qc_flags() -> None:
    fs = 100.0
    t = np.arange(6000) / fs
    data = noise(len(t), 3, 1.0)
    burst = (t >= 30.0) & (t < 31.0)
    data[burst] += 40.0 * np.sin(2 * np.pi * 10.0 * t[burst])
    filled = np.zeros(len(t), dtype=bool)
    filled[2800:2810] = True

    for method in ("classic", "recursive"):
        events, cft = mseed_processing.detect_sta_lta_events(
            data, fs, UTCDateTime(0), sta_s=0.2, lta_s=5.0, trigger_on=4.0, trigger_off=1.5, method=method, filled_mask=filled
        )
        assert len(cft) == len(data)
        assert len(events) == 1
        event = events.iloc[0]
        assert 29.9 <= event["start_seconds_from_beginning"] <= 30.3
        assert event["snr"] > 10
        assert event["dominant_frequency_hz"] == pytest.approx(10.0, abs=1.0)
        assert event["qc_flags"] == "gap"


def two_bursts(fs: float = 100.0):
    """Ruido com um burst forte (30 s) e um fraco (60 s), ambos acima do trigger."""
    t = np.arange(9000) / fs
    data = noise(len(t), 5, 1.0)
    strong = (t >= 30.0) & (t < 31.0)
    weak = (t >= 60.0) & (t < 60.3)
    data[strong] += 40.0 * np.sin(2 * np.pi * 10.0 * t[strong])
    data[weak] += 3.0 * np.sin(2 * np.pi * 10.0 * t[weak])
    kwargs = dict(sta_s=0.2, lta_s=5.0, trigger_on=3.0, trigger_off=1.5)
    return data, fs, kwargs


def test_low_snr_flag_marks_only_weak_events_when_enabled() -> None:
    data, fs, kwargs = two_bursts()

    off, _ = mseed_processing.detect_sta_lta_events(data, fs, UTCDateTime(0), **kwargs)
    on, _ = mseed_processing.detect_sta_lta_events(data, fs, UTCDateTime(0), low_snr_threshold=3.0, **kwargs)

    assert len(on) == len(off) == 2
    assert not off["qc_flags"].str.contains("low_snr").any()  # desligado por padrao
    by_time = on.sort_values("start_seconds_from_beginning")
    strong, weak = by_time.iloc[0], by_time.iloc[1]
    assert strong["snr"] > 3.0 and "low_snr" not in strong["qc_flags"]
    assert weak["snr"] < 3.0 and "low_snr" in weak["qc_flags"]


def test_min_event_snr_discards_weak_events_and_counts_them() -> None:
    data, fs, kwargs = two_bursts()

    kept, _ = mseed_processing.detect_sta_lta_events(data, fs, UTCDateTime(0), min_snr=3.0, **kwargs)

    assert len(kept) == 1
    assert kept.iloc[0]["snr"] >= 3.0
    assert kept.iloc[0]["event_id"] == 1
    assert kept.attrs["discarded_low_snr"] == 1


def test_event_with_undefined_snr_is_kept_and_not_flagged() -> None:
    # Ruido zero antes do evento (ex.: trecho parado): SNR indefinido (NaN). O evento nao e
    # descartado nem marcado, porque nao ha como julgar seu SNR.
    fs = 100.0
    t = np.arange(3000) / fs
    data = np.zeros(len(t))
    data[1500:1600] = 50.0 * np.sin(2 * np.pi * 10.0 * t[1500:1600])

    events, _ = mseed_processing.detect_sta_lta_events(
        data, fs, UTCDateTime(0), sta_s=0.1, lta_s=1.0, trigger_on=1.5, trigger_off=1.2, min_snr=100.0, low_snr_threshold=3.0
    )

    assert len(events) == 1
    assert np.isnan(events.iloc[0]["snr"])
    assert "low_snr" not in events.iloc[0]["qc_flags"]
    assert events.attrs["discarded_low_snr"] == 0


def test_sta_lta_min_duration_discards_short_triggers() -> None:
    fs = 100.0
    data = noise(6000, 4, 1.0)
    data[3000:3005] += 50.0

    events, _ = mseed_processing.detect_sta_lta_events(
        data, fs, UTCDateTime(0), sta_s=0.2, lta_s=5.0, trigger_on=4.0, trigger_off=1.5, min_duration_s=2.0
    )

    assert events.empty
    assert list(events.columns) == mseed_processing.EVENT_COLUMNS


# -----------------------------------------------------------------------------
# Configuracao e CLI
# -----------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"sta": 5.0, "lta": 5.0}, "lta deve ser maior que sta"),
        ({"trigger_on": 2.0, "trigger_off": 3.0}, "trigger_off"),
        ({"freqmin": 10.0, "freqmax": 5.0}, "freqmax deve ser maior que freqmin"),
        ({"spike_method": "unknown"}, "spike_method"),
        ({"taper_max_fraction": 0.8}, "taper_max_fraction"),
        ({"filter_type": "comb"}, "filter_type"),
        ({"filter_family": "chebyshev"}, "filter_family"),
        ({"filter_type": "bandstop", "freqmin": 35.0, "freqmax": 25.0}, "freqmax deve ser maior que freqmin"),
        ({"notch": True, "notch_q": 0.0}, "notch_q"),
        ({"notch": True, "notch_freqs": [60.0, -5.0]}, "notch"),
        ({"notch": True, "notch_freqs": []}, "notch"),
        ({"low_snr_threshold": 0.0}, "low_snr_threshold"),
        ({"qc_window_seconds": 0.004}, "qc_window_seconds"),  # A-3: travava o processamento
        ({"min_event_snr": -1.0}, "min_event_snr"),
    ],
)
def test_config_validation_rejects_inconsistent_parameters(overrides: dict, message: str) -> None:
    config = mseed_processing.ProcessingConfig(data_dir=DATA_DIR, **overrides)
    with pytest.raises(ValueError, match=message):
        config.validate()


def test_validation_only_checks_the_limits_the_filter_type_uses() -> None:
    # Passa-baixa nao usa freqmin; passa-alta nao usa freqmax.
    mseed_processing.ProcessingConfig(data_dir=DATA_DIR, filter_type="lowpass", freqmin=0.0, freqmax=20.0).validate()
    mseed_processing.ProcessingConfig(data_dir=DATA_DIR, filter_type="highpass", freqmin=5.0, freqmax=1.0).validate()
    # Notch desligado: os valores do notch nao bloqueiam o processamento.
    mseed_processing.ProcessingConfig(data_dir=DATA_DIR, notch=False, notch_q=0.0).validate()


def test_parse_frequency_list() -> None:
    assert mseed_processing.parse_frequency_list("60, 29") == [60.0, 29.0]
    assert mseed_processing.parse_frequency_list("60") == [60.0]
    with pytest.raises(Exception, match="Frequencia invalida"):
        mseed_processing.parse_frequency_list("60, abc")
    with pytest.raises(Exception, match="ao menos uma"):
        mseed_processing.parse_frequency_list(" , ")


def test_cli_rejects_invalid_parameters(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as exc_info:
        mseed_processing.main(["--data-dir", str(DATA_DIR), "--sta", "10", "--lta", "5"])

    assert exc_info.value.code == 2
    assert "lta deve ser maior que sta" in capsys.readouterr().err


def test_parse_bands() -> None:
    assert mseed_processing.parse_bands("0.5-2, 2-8") == [(0.5, 2.0), (2.0, 8.0)]


# -----------------------------------------------------------------------------
# Pipeline completo
# -----------------------------------------------------------------------------


def test_backend_processing_generates_expected_outputs(tmp_path: Path) -> None:
    output_dir = tmp_path / "results"
    progress_file = tmp_path / "progress.json"

    completed = subprocess.run(
        [
            sys.executable,
            str(ROOT_DIR / "backend" / "mseed_processing.py"),
            "--data-dir",
            str(DATA_DIR),
            "--output-dir",
            str(output_dir),
            "--progress-file",
            str(progress_file),
        ],
        cwd=ROOT_DIR,
        check=True,
        capture_output=True,
        text=True,
    )

    assert "Concluido." in completed.stdout
    tables = output_dir / "tabelas"
    figures = output_dir / "figuras"
    for name in [
        mseed_processing.SUMMARY_CSV,
        mseed_processing.GLOBAL_CSV,
        mseed_processing.GAPS_CSV,
        mseed_processing.SPIKES_CSV,
        mseed_processing.PSD_CSV,
        mseed_processing.BANDS_CSV,
        mseed_processing.EVENTS_CSV,
        mseed_processing.QC_WINDOWS_CSV,
        mseed_processing.PARAMS_JSON,
    ]:
        assert (tables / name).exists(), name
    for name in [
        mseed_processing.FIG_OVERVIEW,
        mseed_processing.FIG_QC,
        mseed_processing.FIG_PSD,
        mseed_processing.FIG_WINDOW,
        mseed_processing.FIG_SPECTROGRAM,
        mseed_processing.FIG_STALTA,
        mseed_processing.FIG_EVENT,
        mseed_processing.FIG_SPIKE,
    ]:
        assert (figures / name).exists(), name

    global_summary = pd.read_csv(tables / "resumo_global.csv")
    first_row = global_summary.iloc[0]
    assert first_row["trace_id"] == "SY.SYN01.00.HHZ"
    assert first_row["sampling_rate_hz"] == 100.0
    assert first_row["npts"] == 18000

    # Os glitches de 1-2 amostras sao removidos; os transientes de 45 s e 118 s, preservados.
    spikes = pd.read_csv(tables / "spikes_detectados.csv")
    assert sorted(spikes["seconds_from_beginning"].round(2)) == [75.3, 152.7, 152.71]

    # ...e detectados pelo STA/LTA.
    events = pd.read_csv(tables / "eventos_candidatos_sta_lta.csv")
    peak_times = sorted((pd.to_datetime(events["peak_time_utc"]) - pd.Timestamp("2026-01-01", tz="UTC")).dt.total_seconds())
    assert peak_times == pytest.approx([45.0, 118.0], abs=0.1)

    summary = pd.read_csv(tables / "resumo_por_arquivo.csv")
    assert list(summary["arquivo"]) == [f"synthetic_waveform_{i:02d}.mseed" for i in (1, 2, 3)]

    bands = pd.read_csv(tables / "energia_por_banda.csv")
    assert bands["fmax_hz"].max() <= 50.0

    qc = pd.read_csv(tables / "indicadores_por_janela.csv")
    assert len(qc) == 3
    assert qc["spike_count"].sum() == 3

    params = json.loads((tables / "parametros_processamento.json").read_text(encoding="utf-8"))
    assert params["parameters"]["spike_method"] == "residual"
    assert params["effective"]["nyquist_hz"] == 50.0
    assert params["result"]["events_detected"] == 2

    progress = json.loads(progress_file.read_text(encoding="utf-8"))
    assert progress["status"] == "completed"
    assert progress["progress"] == 100


def test_pipeline_with_gaps_and_disabled_steps(tmp_path: Path) -> None:
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    t0 = UTCDateTime("2026-01-01T00:00:00Z")
    make_trace(noise(3000, 1), t0).write(str(data_dir / "part1.mseed"), format="MSEED")
    make_trace(noise(3000, 2), t0 + 40.0).write(str(data_dir / "part2.mseed"), format="MSEED")

    config = mseed_processing.ProcessingConfig(
        data_dir=data_dir,
        output_dir=tmp_path / "out",
        psd=False,
        stalta=False,
        spectrogram=False,
        despike=False,
    )
    result = mseed_processing.run_pipeline(config)

    tables = tmp_path / "out" / "tabelas"
    assert result["events_detected"] == 0
    gaps = pd.read_csv(tables / "gaps.csv")
    assert list(gaps["type"]) == ["gap"]
    global_row = pd.read_csv(tables / "resumo_global.csv").iloc[0]
    assert global_row["filled_samples"] == 1000
    assert global_row["npts"] == 7000
    assert global_row["stalta_method"] == "none"
    # Tabelas vazias continuam legiveis (com cabecalho) e figuras de aviso sao geradas.
    assert list(pd.read_csv(tables / "eventos_candidatos_sta_lta.csv").columns) == mseed_processing.EVENT_COLUMNS
    assert list(pd.read_csv(tables / "psd_welch.csv").columns) == mseed_processing.PSD_COLUMNS
    assert (tmp_path / "out" / "figuras" / mseed_processing.FIG_STALTA).exists()
    qc = pd.read_csv(tables / "indicadores_por_janela.csv")
    assert qc["filled_fraction"].max() > 0


def test_pipeline_with_highpass_and_notch_records_new_fields(tmp_path: Path) -> None:
    # examples/data tem 100 Hz (Nyquist 50 Hz): o notch em 60 Hz e ignorado com aviso e o
    # de 25 Hz e aplicado.
    out = tmp_path / "out"
    code = mseed_processing.main(
        [
            "--data-dir",
            str(DATA_DIR),
            "--output-dir",
            str(out),
            "--filter-type",
            "highpass",
            "--filter-family",
            "bessel",
            "--notch",
            "--notch-freqs",
            "60,25",
            "--no-spectrogram",
        ]
    )
    assert code == 0

    summary = pd.read_csv(out / "tabelas" / "resumo_global.csv").iloc[0]
    assert summary["filter_type"] == "highpass"
    assert summary["filter_family"] == "bessel"
    assert summary["freqmin_hz"] == 1.0
    assert np.isnan(summary["freqmax_hz"])
    assert str(summary["notch_freqs_hz"]) == "25"
    assert summary["notch_q"] == 30.0
    assert "notch + highpass" in summary["preprocessing"]

    metadata = json.loads((out / "tabelas" / "parametros_processamento.json").read_text(encoding="utf-8"))
    assert metadata["parameters"]["filter_type"] == "highpass"
    assert metadata["parameters"]["notch_freqs"] == [60.0, 25.0]
    assert metadata["effective"]["notch_freqs_applied_hz"] == [25.0]
    assert metadata["effective"]["notch_freqs_skipped_hz"] == [60.0]
    assert any("Notch ignorado em 60 Hz" in warning for warning in metadata["warnings"])


def test_pipeline_low_snr_options_record_counts(tmp_path: Path) -> None:
    common = ["--data-dir", str(DATA_DIR), "--no-spectrogram", "--trigger-on", "3", "--trigger-off", "1.5"]
    assert mseed_processing.main([*common, "--output-dir", str(tmp_path / "default")]) == 0
    assert mseed_processing.main(
        [*common, "--output-dir", str(tmp_path / "flag"), "--low-snr-flag", "--low-snr-threshold", "1000"]
    ) == 0
    assert mseed_processing.main([*common, "--output-dir", str(tmp_path / "drop"), "--min-event-snr", "1000"]) == 0

    def summary(name: str) -> pd.Series:
        return pd.read_csv(tmp_path / name / "tabelas" / "resumo_global.csv").iloc[0]

    default, flagged, dropped = summary("default"), summary("flag"), summary("drop")
    assert default["events_detected"] > 0
    # Padrao: nada marcado nem descartado.
    assert np.isnan(default["low_snr_threshold"])
    assert default["events_low_snr"] == 0 and default["events_discarded_low_snr"] == 0
    # Flag com limiar altissimo: todos os eventos com SNR calculavel sao marcados, nenhum some.
    flagged_events = pd.read_csv(tmp_path / "flag" / "tabelas" / "eventos_candidatos_sta_lta.csv")
    assert flagged["events_detected"] == default["events_detected"]
    assert flagged["low_snr_threshold"] == 1000.0
    assert flagged["events_low_snr"] == int(flagged_events["snr"].notna().sum())
    # Descarte: eventos com SNR calculavel saem e sao contados.
    assert dropped["events_discarded_low_snr"] == flagged["events_low_snr"]
    assert dropped["events_detected"] == default["events_detected"] - dropped["events_discarded_low_snr"]
    metadata = json.loads((tmp_path / "drop" / "tabelas" / "parametros_processamento.json").read_text(encoding="utf-8"))
    assert metadata["parameters"]["min_event_snr"] == 1000.0
    assert metadata["effective"]["events_discarded_low_snr"] == dropped["events_discarded_low_snr"]


def test_metadata_only_mode_writes_summary_and_gaps(tmp_path: Path) -> None:
    config = mseed_processing.ProcessingConfig(
        data_dir=DATA_DIR,
        output_dir=tmp_path,
        metadata_only=True,
        files=["synthetic_waveform_02.mseed"],
    )
    result = mseed_processing.run_pipeline(config)

    assert result["metadata_only"] is True
    summary = pd.read_csv(tmp_path / "tabelas" / "resumo_por_arquivo.csv")
    assert list(summary["arquivo"]) == ["synthetic_waveform_02.mseed"]
    assert not (tmp_path / "tabelas" / "resumo_global.csv").exists()


# -----------------------------------------------------------------------------
# Extracao de series temporais (aba Inspecao)
# -----------------------------------------------------------------------------


def test_minmax_downsample_preserves_peaks() -> None:
    data = np.zeros(100_000)
    data[12_345] = 99.0
    data[67_890] = -42.0

    indices, values = extract_timeseries.minmax_downsample(data, 900)

    assert len(values) <= 900
    assert values.max() == 99.0
    assert values.min() == -42.0
    assert np.all(np.diff(indices) > 0)


def test_extract_timeseries_cli_returns_window(tmp_path: Path) -> None:
    completed = subprocess.run(
        [
            sys.executable,
            str(ROOT_DIR / "src" / "server" / "extract_timeseries.py"),
            "--data-dir",
            str(DATA_DIR),
            "--start",
            "2026-01-01T00:00:40Z",
            "--end",
            "2026-01-01T00:01:20Z",
            "--max-points",
            "400",
            "--freqmin",
            "1",
            "--freqmax",
            "20",
        ],
        cwd=ROOT_DIR,
        check=True,
        capture_output=True,
        text=True,
    )
    payload = json.loads(completed.stdout)

    assert payload["traceId"] == "SY.SYN01.00.HHZ"
    assert payload["gapCount"] == 0
    assert payload["filtered"] is True
    assert 0 < len(payload["points"]) <= 400
    assert payload["npts"] == 4001


# -----------------------------------------------------------------------------
# Auditoria de 2026-10-22 (CHANGELOG.md): regressoes dos bugs corrigidos
# -----------------------------------------------------------------------------


def write_glitch_record(data_dir: Path, fs: float = 100.0, seconds: int = 600) -> None:
    """Ruido branco com 3 glitches de 1 amostra, 10^4 vezes maiores que o ruido."""
    data_dir.mkdir()
    rng = np.random.default_rng(11)
    data = rng.normal(scale=100.0, size=int(seconds * fs))
    for k in (int(100 * fs), int(300 * fs), int(500 * fs)):
        data[k] = -4_000_000.0
    make_trace(data, UTCDateTime("2026-01-01T00:00:00Z"), sampling_rate=fs).write(
        str(data_dir / "glitch.mseed"), format="MSEED"
    )


def test_raw_psd_and_bands_are_not_dominated_by_glitches(tmp_path: Path) -> None:
    # A-1: a PSD "bruta" era calculada com os glitches; o espectro plano de um impulso de
    # milhoes de contagens dominava todas as frequencias e as porcentagens por banda.
    write_glitch_record(tmp_path / "data")
    config = mseed_processing.ProcessingConfig(data_dir=tmp_path / "data", output_dir=tmp_path / "out", spectrogram=False)
    mseed_processing.run_pipeline(config)

    psd = pd.read_csv(tmp_path / "out" / "tabelas" / "psd_welch.csv")
    white_noise_level = 2 * 100.0**2 / 100.0  # PSD unilateral do ruido: 2 sigma^2 / fs
    assert psd["psd_raw"].iloc[1:].median() == pytest.approx(white_noise_level, rel=0.2)
    summary = pd.read_csv(tmp_path / "out" / "tabelas" / "resumo_global.csv").iloc[0]
    assert summary["psd_raw_source"] == "despiked"


def test_global_summary_reports_std_without_spikes(tmp_path: Path) -> None:
    # A-2: o desvio padrao bruto inclui os glitches; std_despiked mostra o nivel real.
    write_glitch_record(tmp_path / "data")
    config = mseed_processing.ProcessingConfig(data_dir=tmp_path / "data", output_dir=tmp_path / "out", spectrogram=False)
    mseed_processing.run_pipeline(config)

    summary = pd.read_csv(tmp_path / "out" / "tabelas" / "resumo_global.csv").iloc[0]
    assert summary["std"] > 10 * summary["std_despiked"]
    assert summary["std_despiked"] == pytest.approx(100.0, rel=0.05)


def test_overlapping_files_emit_a_warning(tmp_path: Path) -> None:
    # A-4: overlaps apareciam em gaps.csv mas, ao contrario dos gaps, sem nenhum aviso.
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    t0 = UTCDateTime("2026-01-01T00:00:00Z")
    make_trace(noise(3000, 1), t0).write(str(data_dir / "a.mseed"), format="MSEED")
    make_trace(noise(3000, 2), t0 + 20.0).write(str(data_dir / "b.mseed"), format="MSEED")  # 10 s em dobro
    config = mseed_processing.ProcessingConfig(data_dir=data_dir, output_dir=tmp_path / "out", spectrogram=False)
    mseed_processing.run_pipeline(config)

    metadata = json.loads((tmp_path / "out" / "tabelas" / "parametros_processamento.json").read_text(encoding="utf-8"))
    assert any("overlap" in warning and "1000 amostra" in warning for warning in metadata["warnings"])
