# Changelog

## 2026-10-22 — Technical revision

A full review of the scientific pipeline, the server and the web interface, validated on a
private 24-hour field dataset that is not part of this repository. Everything below is
described without that data.

### Signal processing

- **Despiking no longer removes real events.** The previous method compared each sample with the
  amplitude of the whole record, so the peaks of strong events were flagged and interpolated
  before STA/LTA. The default is now a residual method (moving-median residual, MAD threshold,
  local Hampel confirmation and a maximum width); the old one remains as `--spike-method global`.
- **Absolute timing.** The continuous record is built on a time grid from each file's own header
  instead of plain concatenation, so real gaps no longer shift everything after them. Gaps are
  filled explicitly (`--gap-fill`) and flagged.
- **Clock drift is not reported as gaps.** Contiguous files whose headers drift by less than half a
  sample are aligned and reported as drift (`clock_drift_ppm`, `effective_sampling_rate_hz`,
  `timing_inserted_samples`, `timing_dropped_samples`).
- **Performance.** The record is assembled in O(n) (ObsPy's `Stream.merge` was quadratic on
  thousands of files) and files are decoded from memory: a 24-hour, 1440-file day went from
  46 s to about 8 s, and the time-series API from 22.6 s to 2.3 s.
- Configurable frequency bands cut at Nyquist, a taper limited to a fraction of the record,
  fixed-length QC windows (`--qc-window-seconds`), validation of every parameter and a
  `parametros_processamento.json` file recording parameters, effective values, warnings and
  software versions.

### New options

- **Frequency filter:** band-pass (default), high-pass, low-pass or band-stop; Butterworth
  (default) or Bessel.
- **Notch filters** at one or more frequencies (e.g. 60 Hz mains), applied before the frequency
  filter.
- **Event quality by SNR:** optional `low_snr` flag with a configurable threshold, and
  `--min-event-snr` to discard weak candidates.
- **Help buttons (!)** next to every technical term, with plain-language explanations.

### Web interface

- The Processing tab runs the real pipeline with the parameters on screen, with progress and
  cancellation; previously it was simulated.
- Live filter (type, band and notch) in the Inspection tab, axis titles and full UTC timestamps on
  every chart, and a waveform preview when an event or spike is selected in Results.

### Audit (regression tests reference these IDs)

| ID      | Fix                                                                                                                            |
| ------- | ------------------------------------------------------------------------------------------------------------------------------ |
| A-1     | The raw PSD and raw band energy are computed without the detected spikes (a one-sample glitch has a flat spectrum).            |
| A-2     | New `std_despiked` next to `std` in the global summary.                                                                        |
| A-3     | QC window of at least 1 s (shorter windows made a day of data take hours).                                                     |
| A-4     | Warning when files overlap.                                                                                                    |
| B-1     | File names can no longer become pipeline options (a name starting with `-` could make the pipeline write outside the project). |
| B-2     | A run that produces no output keeps the previous results instead of deleting them.                                             |
| B-3     | Invalid dates are rejected with 400; Python errors reach the client without tracebacks, server paths or colour codes.          |
| B-4     | A trace id cannot start with `-`.                                                                                              |
| B-5     | The export route always removes its temporary folder, also on failure.                                                         |
| B-6     | At most 10 000 file names per run.                                                                                             |
| D-1/D-2 | Old or corrupted data in localStorage no longer breaks the project list or the Processing tab.                                 |
| D-3     | A decimal comma in the notch field (`59,5`) is refused instead of becoming notches at 59 and 5 Hz.                             |
| D-4     | The Upload tab says that uploads are still simulated.                                                                          |
| D-5     | The event/spike selection is cleared when new results arrive (preventive).                                                     |

### Tests and dependencies

- 63 pytest tests and 37 Vitest tests (`npm test`); the TypeScript tests call the real server
  routes against a temporary folder with a fake Python.
- TanStack Start updated to 1.169.3, fixing a critical reflected XSS (GHSA-qx66-fv34-fjm8).

### Branding

- The application is now called **miniSEED Studio**, with a new logo (`public/logo.png`).
