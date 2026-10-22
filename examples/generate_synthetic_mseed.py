from __future__ import annotations

from pathlib import Path

import numpy as np
from obspy import Trace, UTCDateTime


def make_trace() -> Trace:
    rng = np.random.default_rng(20260822)
    sampling_rate = 100.0
    duration_s = 180.0
    npts = int(duration_s * sampling_rate)
    t = np.arange(npts) / sampling_rate

    signal = (
        0.04 * np.sin(2 * np.pi * 3.0 * t)
        + 0.02 * np.sin(2 * np.pi * 11.0 * t)
        + 0.015 * rng.normal(size=npts)
    )

    # Transientes de banda limitada: devem ser preservados e detectados pelo STA/LTA.
    for center_s, amplitude, width_s in [(45.0, 4.5, 0.12), (118.0, -3.8, 0.16)]:
        signal += amplitude * np.exp(-0.5 * ((t - center_s) / width_s) ** 2)

    # Glitches instrumentais de 1-2 amostras: devem ser removidos pelo despike.
    for start_s, amplitude, width in [(75.3, 3.0, 1), (152.7, -2.5, 2)]:
        index = int(round(start_s * sampling_rate))
        signal[index : index + width] += amplitude

    data = np.round(signal * 1_000_000).astype(np.int32)
    trace = Trace(data=data)
    trace.stats.network = "SY"
    trace.stats.station = "SYN01"
    trace.stats.location = "00"
    trace.stats.channel = "HHZ"
    trace.stats.sampling_rate = sampling_rate
    trace.stats.starttime = UTCDateTime("2026-01-01T00:00:00Z")
    return trace


def main() -> None:
    data_dir = Path(__file__).resolve().parent / "data"
    data_dir.mkdir(parents=True, exist_ok=True)

    trace = make_trace()
    samples_per_file = int(60 * trace.stats.sampling_rate)
    for index, start in enumerate(range(0, trace.stats.npts, samples_per_file), start=1):
        segment = trace.copy()
        segment.data = trace.data[start : start + samples_per_file]
        segment.stats.npts = len(segment.data)
        segment.stats.starttime = trace.stats.starttime + start / trace.stats.sampling_rate
        segment.write(str(data_dir / f"synthetic_waveform_{index:02d}.mseed"), format="MSEED")


if __name__ == "__main__":
    main()
