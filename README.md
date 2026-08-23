# mSEED Navigator

[![Python](https://img.shields.io/badge/Python-3.x-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![ObsPy](https://img.shields.io/badge/ObsPy-%3E%3D1.5.0-4B8BBE)](https://docs.obspy.org/)
[![CI](https://github.com/PauloXavi/mseed-navigator/actions/workflows/ci.yml/badge.svg)](https://github.com/PauloXavi/mseed-navigator/actions/workflows/ci.yml)

mSEED Navigator is an interactive application for miniSEED waveform inspection, processing, quality control, and visualization. It combines a Python signal-processing pipeline with a modern web interface for reviewing metadata, metrics, spectral products, candidate STA/LTA triggers, and generated figures.

## Overview

Waveform archives often need several preparation steps before they can be reviewed efficiently. mSEED Navigator provides a reproducible path from miniSEED files to structured quality-control tables, processed signal products, and browser-based visualizations.

```text
miniSEED files
    -> ObsPy reading and metadata extraction
    -> signal preprocessing and filtering
    -> quality-control and spectral metrics
    -> CSV tables and PNG figures
    -> web results API
    -> interactive visualization
```

The Python backend performs the scientific computation. The web application can invoke that pipeline for the bundled demonstration data, expose the resulting artifacts through server routes, and present them as tables, charts, time-series views, and downloadable packages.

## Features

- Recursive discovery and reading of miniSEED-compatible files with ObsPy.
- Preservation and reporting of network, station, location, channel, UTC timing, sampling rate, and sample count metadata.
- Per-file and global waveform statistics, including minimum, maximum, mean, standard deviation, percentiles, median, and median absolute deviation.
- Gap reporting through ObsPy stream metadata.
- Robust spike detection based on the median absolute deviation, with linear interpolation of flagged samples.
- Signal preprocessing with mean removal, linear detrending, cosine tapering, and zero-phase Butterworth band-pass filtering.
- Power spectral density estimation using Welch's method.
- Integrated energy summaries for predefined frequency bands.
- Spectrogram generation for a processed waveform window.
- Classic STA/LTA candidate-trigger detection with configurable windows and trigger thresholds.
- CSV exports for metadata, quality-control metrics, spikes, gaps, spectra, band energy, and STA/LTA candidates.
- PNG figures for waveform overview, raw-versus-processed comparisons, PSD, spectrogram, quality indicators, STA/LTA response, and the highest-ranked candidate window.
- Web views for file metadata, UTC-range waveform inspection, downsampled time series, result tables, charts, generated figures, and ZIP exports.

## Demo Data

The three files in `examples/data/` are entirely synthetic. They are generated from scratch by `examples/generate_synthetic_mseed.py` exclusively for demonstration and automated testing; they are not derived from field measurements or any external dataset.

The generator uses the following fictitious metadata and signal definition:

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

The waveform combines deterministic 3 Hz and 11 Hz sinusoidal components, seeded random noise, and two synthetic transient pulses. A fixed random seed makes the dataset reproducible.

## Architecture

```text
backend/   Python batch processing and artifact generation
examples/  Reproducible synthetic miniSEED generator and sample files
src/       React, TypeScript, TanStack routes, server handlers, and UI
tests/     Pytest coverage for miniSEED reading and backend processing
```

The backend is a standalone Python batch pipeline. It reads miniSEED files, computes waveform and quality-control products, and writes CSV tables and PNG figures.

The web layer is a TanStack Start application. Its server routes can run the Python pipeline against `examples/data/`, parse the generated tables, extract UTC waveform windows, and return JSON to the React interface. Runtime artifacts are written under `public/backend-results/`, which is excluded from version control.

## Scientific / Geophysical Context

miniSEED is a compact format used to store sampled time-series data and basic waveform metadata such as station codes, channels, timing, and sampling rate. It is widely used for seismic and other geophysical waveform exchange.

In seismology and microseismic monitoring, waveform inspection and quality control help identify acquisition gaps, impulsive anomalies, frequency content, and intervals that may warrant closer review. mSEED Navigator supports these preparation and review tasks. Its STA/LTA output identifies threshold-based candidate windows only; it does not locate, classify, or interpret seismic events.

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
- Vite
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

This creates CSV tables in `public/backend-results/demo-public/tabelas/` and PNG figures in `public/backend-results/demo-public/figuras/`.

### Start the web application

With the Python environment prepared and the Node.js dependencies installed, run:

```bash
npm run dev
```

Open the local URL printed by Vite. The server route `/api/results/demo-public` can generate or read the demonstration results from the bundled synthetic data.

## Tests

Install the development requirements and run the Python test suite:

```bash
pip install -r requirements-dev.txt
pytest
```

Run the frontend quality checks:

```bash
npm run lint
npm run build
```

The current pytest suite verifies synthetic miniSEED discovery and reading, trace metadata, segment merging, sampling rate, sample counts, start time, complete backend execution, expected artifacts, empty-file-list handling, and invalid-file handling.

## Example Workflow

The following workflow uses only the synthetic files in `examples/data/`:

1. Optionally regenerate the deterministic demonstration files:

   ```bash
   python examples/generate_synthetic_mseed.py
   ```

2. Run the backend pipeline:

   ```bash
   python backend/mseed_processing.py \
     --data-dir examples/data \
     --output-dir public/backend-results/demo-public
   ```

3. Start the web application:

   ```bash
   npm run dev
   ```

4. Open the URL shown by Vite, create a local project, and open its **Results** tab to review the generated metadata, quality-control summaries, spectral products, candidate STA/LTA windows, and figures.

## Screenshot

A reviewed screenshot of the application interface will be added in a future documentation update. No placeholder image or broken asset link is included here.

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
|   `-- favicon.svg               # Project-owned neutral waveform icon
|-- src/
|   |-- components/               # Project views, result panels, and UI controls
|   |-- routes/                   # Web pages and server API routes
|   |-- server/                   # Python process integration and time-series extraction
|   |-- services/                 # Browser-side project and workflow state
|   `-- styles.css
|-- tests/
|   `-- test_mseed_processing.py  # Pytest backend suite
|-- package.json                  # Frontend scripts and dependencies
|-- requirements.txt              # Python runtime dependencies
`-- requirements-dev.txt          # Python test dependencies
```

## Limitations

- The batch pipeline currently accepts one unique network/station/location/channel trace ID per run. Multi-channel datasets must be processed separately.
- The primary pipeline is intended for ordered, contiguous segments. Gaps are reported, but the current batch concatenation is not a general gap-aware or multi-trace processing workflow.
- The bundled web demonstration reads `examples/data/`; browser upload, extraction progress, and processing-job progress are currently simulated and are not connected to arbitrary uploaded miniSEED files.
- Project and workflow state are stored in browser local storage rather than a database or multi-user service.
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
