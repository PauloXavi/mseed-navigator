from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pandas as pd
import pytest


ROOT_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT_DIR / "examples" / "data"
sys.path.insert(0, str(ROOT_DIR))

from backend import mseed_processing


def test_find_and_read_synthetic_mseed_files() -> None:
    files = mseed_processing.find_mseed_files(DATA_DIR)

    assert len(files) == 3
    assert all(file.name.startswith("synthetic_waveform_") for file in files)

    stream = mseed_processing.read_files(files)

    assert len(stream) == 3
    assert {trace.id for trace in stream} == {"SY.SYN01.00.HHZ"}


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


def test_backend_processing_generates_expected_outputs(tmp_path: Path) -> None:
    output_dir = tmp_path / "results"

    completed = subprocess.run(
        [
            sys.executable,
            str(ROOT_DIR / "backend" / "mseed_processing.py"),
            "--data-dir",
            str(DATA_DIR),
            "--output-dir",
            str(output_dir),
        ],
        cwd=ROOT_DIR,
        check=True,
        capture_output=True,
        text=True,
    )

    assert "Concluido." in completed.stdout
    assert (output_dir / "tabelas" / "resumo_global.csv").exists()
    assert (output_dir / "tabelas" / "resumo_por_arquivo.csv").exists()
    assert (output_dir / "tabelas" / "eventos_candidatos_sta_lta.csv").exists()
    assert (output_dir / "figuras" / "visao_geral_24h_bruto.png").exists()
    assert (output_dir / "figuras" / "principal_evento_candidato.png").exists()

    global_summary = pd.read_csv(output_dir / "tabelas" / "resumo_global.csv")
    first_row = global_summary.iloc[0]
    assert first_row["trace_id"] == "SY.SYN01.00.HHZ"
    assert first_row["sampling_rate_hz"] == 100.0
    assert first_row["npts"] == 18000
