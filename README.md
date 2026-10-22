<p align="center">
  <img src="public/logo.png" alt="miniSEED Studio" width="320" />
</p>

# miniSEED Studio

[![Python](https://img.shields.io/badge/Python-3.11%2B-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![ObsPy](https://img.shields.io/badge/ObsPy-%3E%3D1.5.0-4B8BBE)](https://docs.obspy.org/)
[![CI](https://github.com/PauloXavi/mseed-navigator/actions/workflows/ci.yml/badge.svg)](https://github.com/PauloXavi/mseed-navigator/actions/workflows/ci.yml)

miniSEED Studio (repository `mseed-navigator`) is an interactive application for miniSEED waveform inspection, processing, quality control, and visualization. It combines a Python signal-processing pipeline with a web interface for reviewing metadata, quality metrics, spectral products, candidate STA/LTA triggers, and generated figures.

The interface is in Portuguese. See [CHANGELOG.md](CHANGELOG.md) for what changed in the latest revision.

## Overview

Waveform archives often need several preparation steps before they can be reviewed efficiently. miniSEED Studio provides a reproducible path from miniSEED files to structured quality-control tables, processed signal products, and browser-based visualizations.

```text
miniSEED files
    -> ObsPy reading and metadata extraction
    -> continuous record on an absolute time grid (gaps, overlaps, clock drift)
    -> despiking, preprocessing, notch and frequency filtering
    -> quality-control and spectral metrics, STA/LTA candidates
    -> CSV tables, PNG figures and a parameters file
    -> web results API
    -> interactive visualization
```

The Python backend performs the scientific computation. The web application runs that pipeline with the parameters chosen on screen, exposes the resulting artifacts through server routes, and presents them as tables, charts, time-series views, and downloadable packages.

## Features

### Scientific pipeline

- Recursive discovery and reading of miniSEED-compatible files with ObsPy (decoded from memory for speed).
- Continuous record built from each file's own start time: real gaps are filled explicitly (`--gap-fill`) and flagged, overlaps are reported, and small clock drift between contiguous files is aligned and reported in ppm instead of being counted as gaps.
- Per-file and global statistics: minimum, maximum, mean, standard deviation (with and without spikes), percentiles, median, and median absolute deviation.
- Spike (glitch) removal with a moving-median residual, MAD threshold, local Hampel confirmation, and a maximum width, so the peaks of real events are preserved. The previous whole-record method remains available as `--spike-method global`.
- Preprocessing with mean removal, linear detrending, and a cosine taper limited to a fraction of the record.
- Frequency filter: band-pass (default), high-pass, low-pass, or band-stop; Butterworth (default) or Bessel; zero-phase by default.
- Notch filters at one or more frequencies (for example, 60 Hz mains), applied before the frequency filter.
- Power spectral density with Welch's method and energy in configurable frequency bands, cut at Nyquist.
- Spectrogram of a processed window.
- Classic or recursive STA/LTA candidate triggers with duration limits, SNR, dominant frequency, and quality flags (`edge`, `gap`, optional `low_snr`); `--min-event-snr` discards weak candidates.
- Fixed-length QC windows (`--qc-window-seconds`) with std, percentiles, peak, band RMS, spike count, filled fraction, and flat-signal detection.
- `parametros_processamento.json` with the parameters, effective values, warnings, software versions, and run time.

### Web application

- Projects stored in the browser, file metadata, and a metadata dialog for each file.
- Inspection of any UTC window with min/max downsampling, real gaps, and an optional live filter (type, band, and notch).
- Processing tab that runs the real pipeline with the parameters on screen, with progress and cancellation.
- Results with summaries, QC charts, gaps, spikes, PSD, band energy, STA/LTA candidates, figures, and the run parameters; selecting an event or spike shows its waveform.
- Help buttons (!) with plain-language explanations of every technical term.
- ZIP exports of tables, figures, or both.

## Demo Data

The three files in `examples/data/` are entirely synthetic. They are generated from scratch by `examples/generate_synthetic_mseed.py` exclusively for demonstration and automated testing; they are not derived from field measurements or any external dataset.

| Field          | Value                                                 |
| -------------- | ----------------------------------------------------- |
| Network        | `SY`                                                  |
| Station        | `SYN01`                                               |
| Location       | `00`                                                  |
| Channel        | `HHZ`                                                 |
| Trace ID       | `SY.SYN01.00.HHZ`                                     |
| Start time     | `2026-01-01T00:00:00Z`                                |
| Sampling rate  | `100 Hz`                                              |
| Total duration | `180 s`                                               |
| Total samples  | `18,000`                                              |
| File layout    | Three consecutive 60-second files, 6,000 samples each |

The waveform combines deterministic 3 Hz and 11 Hz sinusoidal components, seeded random noise, two band-limited transients (which the pipeline must keep and detect), and two instrumental glitches of one and two samples (which despiking must remove). A fixed random seed makes the dataset reproducible.

## Architecture

```text
backend/   Python batch processing and artifact generation
examples/  Reproducible synthetic miniSEED generator and sample files
src/       React, TypeScript, TanStack routes, server handlers, and UI
tests/     Pytest suite for the backend
```

The backend is a standalone Python batch pipeline. It reads miniSEED files, computes waveform and quality-control products, and writes CSV tables, PNG figures, and a parameters file.

The web layer is a TanStack Start application. Its server routes run the Python pipeline, parse the generated tables, extract UTC waveform windows, and return JSON to the React interface. The data folder is `MSEED_DATA_DIR` if set, else a `dados/` folder next to the repository (`../dados`), else `examples/data/`. Runtime artifacts are written under `public/backend-results/` and `.cache/`, both excluded from version control.

## Scientific / Geophysical Context

miniSEED is a compact format used to store sampled time-series data and basic waveform metadata such as station codes, channels, timing, and sampling rate. It is widely used for seismic and other geophysical waveform exchange.

In seismology and microseismic monitoring, waveform inspection and quality control help identify acquisition gaps, timing problems, instrumental glitches, frequency content, and intervals that may warrant closer review. miniSEED Studio supports these preparation and review tasks. Its STA/LTA output identifies threshold-based candidate windows only; it does not locate, classify, or interpret seismic events.

## Tech Stack

### Scientific backend

- Python
- ObsPy
- NumPy
- SciPy
- pandas
- Matplotlib

### Web application

- React
- TypeScript
- TanStack Start, Router, and Query
- Vite and Vitest
- Tailwind CSS
- Radix UI
- Recharts
- Lucide icons

## Installation

Run all commands from the repository root.

### Python backend

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

The web server uses `.venv/bin/python` (or `../.venv/bin/python`) when it exists, and `python3` otherwise.

### Frontend

```bash
npm install
```

The web export routes use the system `zip` utility when creating downloadable archives.

## Running the Application

### Run the Python backend

The backend is a batch processor rather than a separate HTTP service. Process the bundled synthetic dataset with:

```bash
python backend/mseed_processing.py \
  --data-dir examples/data \
  --output-dir public/backend-results/demo-public
```

This creates CSV tables and `parametros_processamento.json` in `public/backend-results/demo-public/tabelas/` and PNG figures in `public/backend-results/demo-public/figuras/`. Run `python backend/mseed_processing.py --help` for every option, for example:

```bash
python backend/mseed_processing.py --data-dir examples/data --output-dir out \
  --filter-type bandpass --freqmin 1 --freqmax 45 \
  --notch --notch-freqs 60 \
  --low-snr-flag --low-snr-threshold 3
```

### Start the web application

With the Python environment prepared and the Node.js dependencies installed, run:

```bash
npm run dev
```

Open the local URL printed by Vite, create a project, and process it from the **Processamento** tab.

## Tests

```bash
pip install -r requirements-dev.txt
pytest                 # backend
npm test               # server routes and browser storage (Vitest)
npx tsc --noEmit       # type check
npm run lint
npm run build
```

The pytest suite covers miniSEED reading, the continuous record (gaps, overlaps, clock drift), despiking, filters and notch, PSD and band energy, STA/LTA and its quality flags, parameter validation, the time-series extraction script, and the complete pipeline on the synthetic data. The Vitest suite calls the real server routes against a temporary folder with a fake Python, covering file-name validation, safe replacement of results, error messages, exports, and corrupted browser storage. The same checks run in CI.

## Project Structure

```text
.
|-- backend/
|   `-- mseed_processing.py       # Scientific processing pipeline and CLI
|-- examples/
|   |-- data/                     # Three synthetic miniSEED segments
|   |-- generate_synthetic_mseed.py
|   `-- README.md
|-- public/
|   |-- logo.png                  # Full logo
|   |-- logo-mark.png             # Logo without the name (app header)
|   `-- favicon.*, apple-touch-icon.png
|-- src/
|   |-- __tests__/                # Vitest suite
|   |-- components/               # Project views, result panels, help buttons, and UI controls
|   |-- lib/glossary.ts           # Texts of the help buttons (!)
|   |-- routes/                   # Web pages and server API routes
|   |-- server/                   # Python process integration and time-series extraction
|   |-- services/                 # Browser-side project, parameter, and workflow state
|   `-- styles.css
|-- tests/
|   `-- test_mseed_processing.py  # Pytest backend suite
|-- CHANGELOG.md
|-- package.json                  # Frontend scripts and dependencies
|-- requirements.txt              # Python runtime dependencies
`-- requirements-dev.txt          # Python test dependencies
```

## Limitations

- One network/station/location/channel trace ID per run. Multi-channel datasets must be processed separately.
- Browser upload and ZIP extraction are still simulated: processing always uses the server's data folder.
- Project and workflow state are stored in browser local storage rather than a database or multi-user service.
- The server runs Python as a child process, so it needs a Node.js host with Python installed; serverless targets without child processes are not supported.
- No instrument-response removal, physical-unit conversion, phase picking, event classification, hypocenter location, inversion, tomography, or automated geological interpretation is implemented.
- STA/LTA detections are parameter-dependent candidate windows and require expert review.
- ZIP downloads from the web interface require a compatible system `zip` command.

## Data & Privacy

The sample miniSEED files included in this repository are synthetic and contain no proprietary or field-acquisition data.

Generated processing outputs are local runtime artifacts and are excluded from version control.

## Author

**Paulo Gabriel Xavier Marques**<br>
Geophysicist | M.Sc. in Applied Geophysics

[GitHub: PauloXavi](https://github.com/PauloXavi)
