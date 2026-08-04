# proj — Configuration

All IDs needed to interact with the GitHub Project via `gh` CLI.

## Project

| Property | Value |
|----------|-------|
| Name | @rinebob's Savant Trader |
| Number | 1 |
| ID | PVT_kwHOAlkFjc4BfMS9 |
| Owner | rinebob |
| URL | https://github.com/users/rinebob/projects/1 |
| Repo | rinebob/rel-str |
| Default Branch | prod |

## Fields

### Status (single-select)

| Option | Option ID |
|--------|-----------|
| Idea | `540f02c8` |
| Plan | `cbe47bd5` |
| Blueprint | `16324f56` |
| Backlog | `c98e776e` |
| In Progress | `4fb017f2` |
| QA | `71647f9a` |
| Done | `57f03408` |

**Field ID:** `PVTSSF_lAHOAlkFjc4BfMS9zhZg6AA`

### Priority (single-select)

| Option | Option ID |
|--------|-----------|
| P0 | `79628723` |
| P1 | `0a877460` |
| P2 | `da944a9c` |

**Field ID:** `PVTSSF_lAHOAlkFjc4BfMS9zhZg6QA`

### Size (single-select)

| Option | Option ID |
|--------|-----------|
| XS | `eff732af` |
| S | `9592a5a3` |
| M | `9728cbdc` |
| L | `c53df028` |
| XL | `7b141a16` |

**Field ID:** `PVTSSF_lAHOAlkFjc4BfMS9zhZg6QE`

### BE Status (single-select)

| Option | Option ID |
|--------|-----------|
| Not Started | `9de4dd6a` |
| In Progress | `bd4b4db9` |
| Blocked | `ab1f3926` |
| In Review | `b8e804c0` |
| Done | `99b671da` |
| N/A | `222710e3` |

**Field ID:** `PVTSSF_lAHOAlkFjc4BfMS9zhZnE38`

### FE Status (single-select)

| Option | Option ID |
|--------|-----------|
| Not Started | `edc6a799` |
| In Progress | `02a21bbf` |
| Blocked | `ddcb0422` |
| In Review | `0b7d25c2` |
| Done | `1708445d` |
| N/A | `0111a41d` |

**Field ID:** `PVTSSF_lAHOAlkFjc4BfMS9zhZnE4Y`

### SHARED Status (single-select)

| Option | Option ID |
|--------|-----------|
| Not Started | `7e98ca45` |
| In Progress | `55fd5ad9` |
| Blocked | `d58810b8` |
| In Review | `ef116498` |
| Done | `546c2991` |
| N/A | `26d004d1` |

**Field ID:** `PVTSSF_lAHOAlkFjc4BfMS9zhZnE64`

### Other Fields (text/date/number — no option IDs needed)

| Field | ID |
|-------|----|
| Title | `PVTF_lAHOAlkFjc4BfMS9zhZg5_4` |
| Assignees | `PVTF_lAHOAlkFjc4BfMS9zhZg5_8` |
| Labels | `PVTF_lAHOAlkFjc4BfMS9zhZg6AE` |
| Estimate | `PVTF_lAHOAlkFjc4BfMS9zhZg6QI` |
| Iteration | `PVTIF_lAHOAlkFjc4BfMS9zhZg6QM` |
| Start date | `PVTF_lAHOAlkFjc4BfMS9zhZg6QQ` |
| Target date | `PVTF_lAHOAlkFjc4BfMS9zhZg6QU` |

## Labels

| Label | Color | Description |
|-------|-------|-------------|
| `topic` | 5319e7 | Top-level project feature/idea |
| `idea` | fbca04 | Raw idea captured via /proj idea |
| `prd` | 0075ca | Product Requirements Document |
| `task` | 0e8a16 | Implementation task within a topic |
| `phase` | 1d76db | Implementation phase within a topic |
| `area:be` | c5def5 | Backend area |
| `area:fe` | c5def5 | Frontend area |
| `area:shared` | c5def5 | Shared code area (types, interfaces, constants) |
| `file-locked` | b60205 | File is locked by a topic via @topic tag |

## Area → Status Field Mapping

| Area | Label | Status Field | Field ID |
|------|-------|-------------|----------|
| Backend | `area:be` | BE Status | `PVTSSF_lAHOAlkFjc4BfMS9zhZnE38` |
| Frontend | `area:fe` | FE Status | `PVTSSF_lAHOAlkFjc4BfMS9zhZnE4Y` |
| Shared | `area:shared` | SHARED Status | `PVTSSF_lAHOAlkFjc4BfMS9zhZnE64` |

## Lifecycle Stage → Status Mapping

| Stage | Status Option |
|-------|---------------|
| idea | Idea |
| plan | Plan |
| blueprint | Blueprint |
| implement | In Progress |
| review | QA |
| ship | Done |
