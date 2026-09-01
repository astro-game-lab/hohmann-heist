# Attributions

Third-party material bundled with or used by __GAME_NAME__, and the terms it comes under.

Every asset, dataset, and kernel that this repository ships or downloads is listed here. If you add one, add its row in the same commit — an unattributed asset is a licensing bug, and CI cannot catch it for us.

## Assets

Art, audio, models, fonts, and other authored media.

| File / directory | Source | Author | Licence | Notes |
| --- | --- | --- | --- | --- |
| _none yet_ | | | | |

## Data

Ephemerides, SPICE kernels, TLE sets, planetary constants, imagery, and other datasets.

| File / directory | Source | Provider | Licence / terms | Retrieved |
| --- | --- | --- | --- | --- |
| _none yet_ | | | | |

Large data files should not be committed raw — link them or fetch them with a script, and record the source and retrieval date here either way. Note that most public ephemeris sources (JPL, CelesTrak, Space-Track) have their own terms of use and attribution requirements, and some prohibit redistribution.

## Physical constants

Values baked into the simulation, with their source. Keep this in sync with `docs/PHYSICS.md`.

| Constant | Value | Source |
| --- | --- | --- |
| `MU_EARTH` | 3.986004418e14 m³/s² | EGM-96 / WGS-84 geocentric gravitational constant |
| `R_EARTH_EQ` | 6378137.0 m | WGS-84 semi-major axis |
| `J2_EARTH` | 1.08262668e-3 | EGM-96 |

## Software dependencies

Runtime and build dependencies are declared in the manifest and lockfile, and their licences travel with them; they are not duplicated here. Vendored or patched third-party source, however, goes in this table.

| Path | Upstream | Licence | Why vendored |
| --- | --- | --- | --- |
| _none yet_ | | | |
