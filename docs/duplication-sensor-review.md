# Duplication sensor review

An investigation of the duplication sensor's method on lightcycle, per REC-182. Nothing in `sensors/src/` changed. The recommendation is at the end.

## Target and baseline

The target is lightcycle at commit `c1933e0ed5c9c7bd1329ec232078d708b8e6607a`, checked out as a clean `git worktree add` outside the lightcycle checkout, scanned with `recognizer scan --extract` (Python: 429 modules), then `recognizer-sensors duplication` at the defaults (threshold 0.82, min_lines 4, min_nodes 20).

The baseline run produced **533 findings**, which does not equal the live file's 537. The live file was made from a working tree with untracked files (`modified: true`); the clean checkout lacks four findings from them. Every number below is from the clean checkout. Lightcycle exercises Python only, so steps 1 to 4 say nothing about TypeScript, Kotlin or Rust; the corpus covers those.

The spec's "21 four-line `Config.ci_*` accessors" does not reproduce (4 `def ci_` accessors). The measured family is 22 mutually similar `Config` accessors of all names.

## 1. Sample classification

The sample is `random.Random(182).sample(findings, 40)` over the 533 findings sorted by `id`. Each was read in the source.

| Label            | Count |
| ---------------- | ----- |
| real-copy        | 6     |
| rightly-separate | 34    |
| wrong            | 0     |

The Wilson 95% interval for the `real-copy` share is 6/40 = 15%, interval 7.1% to 29.1%. No sampled finding was `wrong`: every pair is structurally similar, so the method is sound on similarity and the count is inflated by what it chooses to report. The three `real-copy` Config accessors (`github_poll_seconds`, `worktree_retries`, `tick_failure_cap`/`worker_history`) share a five-line "environment value or required setting" body that a private helper would absorb; the other Config accessors differ in range checks and are rightly separate.

1. `duplication:lightcycle/config.py::Config.price_haiku_input_per_mtok|lightcycle/config.py::Config.price_opus_output_per_mtok` - rightly-separate - Config accessor that reads its own setting key and range; the shared body would only move the key, and each accessor is a setting's public name.
2. `duplication:lightcycle/config.py::Config.guidance_budget_bytes|lightcycle/config.py::Config.guidance_dormant_days` - rightly-separate - Config accessor that reads its own setting key and range; the shared body would only move the key, and each accessor is a setting's public name.
3. `duplication:lightcycle/config.py::Config.ci_check_ceiling_seconds|lightcycle/config.py::Config.ci_no_workflows_wait_seconds` - rightly-separate - Config accessor that reads its own setting key and range; the shared body would only move the key, and each accessor is a setting's public name.
4. `duplication:lightcycle/config.py::Config.github_poll_seconds|lightcycle/config.py::Config.worktree_retries` - real-copy
5. `duplication:lightcycle/config.py::Config.github_view_refresh_polls|lightcycle/config.py::Config.tick_lag_share` - rightly-separate - Config accessor that reads its own setting key and range; the shared body would only move the key, and each accessor is a setting's public name.
6. `duplication:lightcycle/config.py::Config.ci_start_window_seconds|lightcycle/config.py::Config.probe_cooldown_seconds` - rightly-separate - Config accessor that reads its own setting key and range; the shared body would only move the key, and each accessor is a setting's public name.
7. `duplication:lightcycle/adapters/tui/views/done.py::DoneTable.on_resize|lightcycle/adapters/tui/views/done.py::DoneTable.on_show` - rightly-separate - Two event handlers of one widget that call the same one-line refresh; merging saves nothing.
8. `duplication:lightcycle/config.py::Config.ci_no_workflows_wait_seconds|lightcycle/config.py::Config.shutdown_grace_seconds` - rightly-separate - Config accessor that reads its own setting key and range; the shared body would only move the key, and each accessor is a setting's public name.
9. `duplication:lightcycle/adapters/sqlite/feedback.py::FeedbackAggregate.set_comments_handled_through|lightcycle/adapters/sqlite/runs.py::RunsAggregate.set_comments_dispatched_through` - rightly-separate - Two SQL setters that update different columns in different aggregates.
10. `duplication:lightcycle/config.py::Config.tick_lag_share|lightcycle/config.py::Config.tui_doctor_check_seconds` - rightly-separate - Config accessor that reads its own setting key and range; the shared body would only move the key, and each accessor is a setting's public name.
11. `duplication:lightcycle/config.py::Config.price_opus_input_per_mtok|lightcycle/config.py::Config.price_opus_output_per_mtok` - rightly-separate - Config accessor that reads its own setting key and range; the shared body would only move the key, and each accessor is a setting's public name.
12. `duplication:lightcycle/config.py::Config.ci_start_window_seconds|lightcycle/config.py::Config.github_view_refresh_polls` - rightly-separate - Config accessor that reads its own setting key and range; the shared body would only move the key, and each accessor is a setting's public name.
13. `duplication:lightcycle/application/flow/claim_step.py::ClaimStepUseCase.__init__|lightcycle/application/pool/resolve_merged_prs.py::ResolveMergedPrsUseCase.__init__` - rightly-separate - Constructor that stores its own collaborators; the shared shape is the assignment idiom, not logic.
14. `duplication:lightcycle/application/work/item_context.py::ItemContextReader._title|lightcycle/application/work/step_context.py::StepContext._pass_of` - rightly-separate - Two lookups that guard `get_node` with different exceptions and different empty values.
15. `duplication:lightcycle/config.py::Config.guidance_dormant_days|lightcycle/config.py::Config.guidance_unused_after_deliveries` - rightly-separate - Config accessor that reads its own setting key and range; the shared body would only move the key, and each accessor is a setting's public name.
16. `duplication:lightcycle/adapters/sqlite/feedback.py::FeedbackAggregate.pool_updated_heads|lightcycle/adapters/sqlite/usage.py::UsageAggregate.logs_for_step` - rightly-separate - Two single-query reads over different tables in different aggregates.
17. `duplication:lightcycle/application/flow/select_guidance.py::SelectGuidanceUseCase.__init__|lightcycle/application/setup/project_scan.py::ScanProjectsUseCase.__init__` - rightly-separate - Constructor that stores its own collaborators; the shared shape is the assignment idiom, not logic.
18. `duplication:lightcycle/application/pool/pool_control.py::PoolDrainStatusUseCase.__init__|lightcycle/application/pool/pool_hold_status.py::PoolHoldStatusUseCase.__init__` - rightly-separate - Constructor that stores its own collaborators; the shared shape is the assignment idiom, not logic.
19. `duplication:lightcycle/application/pool/pool_control.py::PoolDrainStatusUseCase.__init__|lightcycle/application/workflows/pin_drift.py::PinDrift.__init__` - rightly-separate - Constructor that stores its own collaborators; the shared shape is the assignment idiom, not logic.
20. `duplication:lightcycle/application/workflows/pin_drift.py::PinDrift.__init__|lightcycle/application/workflows/remove.py::RemoveWorkflowSourceUseCase.__init__` - rightly-separate - Constructor that stores its own collaborators; the shared shape is the assignment idiom, not logic.
21. `duplication:lightcycle/adapters/guidance_sync_status.py::load|lightcycle/adapters/memory_gate_status.py::load` - real-copy
22. `duplication:lightcycle/config.py::Config.ci_check_ceiling_seconds|lightcycle/config.py::Config.ci_start_window_seconds` - rightly-separate - Config accessor that reads its own setting key and range; the shared body would only move the key, and each accessor is a setting's public name.
23. `duplication:lightcycle/config.py::Config.worker_history|lightcycle/config.py::Config.worktree_retries` - real-copy
24. `duplication:lightcycle/config.py::Config.price_haiku_output_per_mtok|lightcycle/config.py::Config.price_sonnet_output_per_mtok` - rightly-separate - Config accessor that reads its own setting key and range; the shared body would only move the key, and each accessor is a setting's public name.
25. `duplication:lightcycle/application/pool/detect_head_moved.py::DetectHeadMovedUseCase.__init__|lightcycle/application/pool/pool_hold_status.py::PoolHoldStatusUseCase.__init__` - rightly-separate - Constructor that stores its own collaborators; the shared shape is the assignment idiom, not logic.
26. `duplication:lightcycle/config.py::Config.tick_failure_cap|lightcycle/config.py::Config.worktree_retries` - real-copy
27. `duplication:lightcycle/config.py::Config.github_reserve_calls|lightcycle/config.py::Config.guidance_budget_bytes` - rightly-separate - Config accessor that reads its own setting key and range; the shared body would only move the key, and each accessor is a setting's public name.
28. `duplication:lightcycle/config.py::Config.stall_seconds|lightcycle/config.py::Config.tui_upgrade_check_seconds` - rightly-separate - Config accessor that reads its own setting key and range; the shared body would only move the key, and each accessor is a setting's public name.
29. `duplication:lightcycle/application/pool/pool_hold_status.py::PoolHoldStatusUseCase.__init__|lightcycle/application/workflows/pin_drift.py::PinDrift.__init__` - rightly-separate - Constructor that stores its own collaborators; the shared shape is the assignment idiom, not logic.
30. `duplication:lightcycle/config.py::Config.guidance_dormant_days|lightcycle/config.py::Config.tui_doctor_check_seconds` - rightly-separate - Config accessor that reads its own setting key and range; the shared body would only move the key, and each accessor is a setting's public name.
31. `duplication:lightcycle/config.py::Config.shutdown_grace_seconds|lightcycle/config.py::Config.tui_upgrade_check_seconds` - rightly-separate - Config accessor that reads its own setting key and range; the shared body would only move the key, and each accessor is a setting's public name.
32. `duplication:lightcycle/application/work/has_feedback.py::has_feedback|lightcycle/application/work/pending_reflections.py::item_reflection_count` - real-copy
33. `duplication:lightcycle/application/setup/restore_store.py::RestoreStoreUseCase.__init__|lightcycle/application/work/trace.py::TraceUseCase.__init__` - rightly-separate - Constructor that stores its own collaborators; the shared shape is the assignment idiom, not logic.
34. `duplication:lightcycle/config.py::Config.release_hold_note_seconds|lightcycle/config.py::Config.shutdown_grace_seconds` - rightly-separate - Config accessor that reads its own setting key and range; the shared body would only move the key, and each accessor is a setting's public name.
35. `duplication:lightcycle/adapters/config_reload_status.py::save|lightcycle/adapters/spin.py::save` - real-copy
36. `duplication:lightcycle/config.py::Config.guidance_unused_after_deliveries|lightcycle/config.py::Config.pool_upgrade_check_seconds` - rightly-separate - Config accessor that reads its own setting key and range; the shared body would only move the key, and each accessor is a setting's public name.
37. `duplication:lightcycle/config.py::Config.shutdown_grace_seconds|lightcycle/config.py::Config.tick_lag_window_seconds` - rightly-separate - Config accessor that reads its own setting key and range; the shared body would only move the key, and each accessor is a setting's public name.
38. `duplication:lightcycle/application/pool/memory_gate.py::MemoryGateUseCase.__init__|lightcycle/application/workflows/remove.py::RemoveWorkflowSourceUseCase.__init__` - rightly-separate - Constructor that stores its own collaborators; the shared shape is the assignment idiom, not logic.
39. `duplication:lightcycle/config.py::Config.pool_upgrade_check_seconds|lightcycle/config.py::Config.tick_lag_share` - rightly-separate - Config accessor that reads its own setting key and range; the shared body would only move the key, and each accessor is a setting's public name.
40. `duplication:lightcycle/config.py::Config.release_hold_note_seconds|lightcycle/config.py::Config.stall_seconds` - rightly-separate - Config accessor that reads its own setting key and range; the shared body would only move the key, and each accessor is a setting's public name.

## 2. Reference overlap

The reference is jscpd, not PMD CPD: CPD needs a JVM and none is installed. Version `jscpd 4.3.0` (`npx --yes jscpd@4`), run as `npx --yes jscpd@4 --min-tokens 50 --min-lines 4 --format python --reporters json --output <dir> <worktree>/lightcycle`, with tests included. 50 tokens is jscpd's default. A second run at `--min-tokens 30` found 187 clones; the 50-token run found 59.

A clone matches a finding when its two regions overlap the finding's two members' line ranges in the same files.

| Group                                    | Count |
| ---------------------------------------- | ----- |
| Sensor findings with a matching clone    | 21    |
| Sensor findings without a matching clone | 512   |
| Clones with a matching finding           | 19    |
| Clones without a matching finding        | 40    |

The two detectors barely agree, because they answer different questions. jscpd matches exact token runs, identifiers and literals included, so two functions that differ only by names and strings are not a clone. The sensor normalises identifiers and literals away and compares whole functions. The sensor sees renamed copies jscpd cannot; jscpd sees partial and sub-function copies and short methods the sensor cannot.

### Sensor findings with no clone (first ten by id)

1. `adapters/breaker.py::save` and `adapters/workers.py::write_workers` - a genuine seven-line atomic-write copy; jscpd missed it because the function and path names differ and the run is under 50 tokens.
2. `config_reload_status.py::load` and `guidance_sync_status.py::load` - a genuine ten-line copy differing in names and a message string; missed for the same reason.
3. `config_reload_status.py::load` and `memory_gate_status.py::load` - the same family as 2.
4. `config_reload_status.py::save` and `github_budget_status.py::save` - the atomic-write family again; real, missed on identifiers.
5. `config_reload_status.py::save` and `guidance_sync_status.py::save` - same family.
6. `config_reload_status.py::save` and `spin.py::save` - same family.
7. `fsio.py::list_dir` and `lifecycle_runner.py::list_data_dirs` - a genuine four-line copy under 50 tokens.
8. `GitHubEventsAdapter.head_sha` and `GitHubEventsAdapter.issue_state` - a real fifteen-line copy of the run-gh, check, parse-JSON, return shape; the differing command and message strings break an exact match.
9. `GitHubEventsAdapter.pull_comments` and `GitHubEventsAdapter.reviews` - two fifty-line paginated `gh api` readers differing in the query; real, and the differing jq text breaks the exact match.
10. `github_budget_status.py::save` and `guidance_sync_status.py::save` - same family as 4.

### Clones with no finding (first ten by file path then start line)

1. `breaker.py` 33-41 and `memory_gate_status.py` 34-42 - adapter classes delegating `load` and `save` to module functions; real boilerplate, but each method is two lines, under `min_lines`.
2. `config_reload_status.py` 34-42 and `memory_gate_status.py` 34-42 - same boilerplate.
3. `github.py` 465-473 and 50-58 - the run, check return code, parse JSON tail inside two longer functions whose whole-function similarity is under 0.82; a real partial copy the sensor cannot see.
4. `github.py` 549-559 and 519-529 - two branch-protection probes sharing their first eleven lines; a real partial copy.
5. `github.py` 667-676 and 457-464 - the heads of `pr_view` and `pr_sync_state`; a real partial copy.
6. `github.py` 677-685 and 464-472 - the next lines of those two functions; the same partial copy.
7. `github_budget_status.py` 34-42 and `memory_gate_status.py` 34-42 - the delegating adapters of 1.
8. `guidance_sync_status.py` 34-42 and `memory_gate_status.py` 34-42 - the delegating adapters of 1.
9. `machine.py` 195-203 and 96-104 - the reading-summing loop in two long functions; a real partial copy.
10. `sqlite/items.py` 49-53 and 38-42 - the identical first five lines of `replace_artifact` and `add_artifact`; a real partial copy.

The sensor's blind spot is granularity: it compares whole functions, so a copied region inside two different longer functions, and any function under the gates, is invisible to it.

## 3. Clustering

The graph has the functions in any finding as nodes and the findings as edges. The 533 findings form **68 connected components**, so the collapsed finding count is **68**. 47 of the components are plain pairs; 8 sit entirely in `config.py`.

Every component is a clique (each has N*(N-1)/2 edges), so the components are mutual families, not chains, and the maximal-clique alternative adds nothing.

| Component | Size N | Edges | N*(N-1)/2 |
| --- | --- | --- | --- |
| 22 `Config` accessors of all names (`ci_check_ceiling_seconds`, `ci_no_workflows_wait_seconds`, `ci_start_window_seconds`, `ci_unconfirmed_note_polls`, `github_reserve_calls`, `github_view_refresh_polls`, ...) | 22 | 231 | 231 |
| 12 use-case `__init__` constructors (`ReflectUseCase`, `CadenceGatesUseCase`, `DetectHeadMovedUseCase`, `MemoryGateUseCase`, `PoolDrainStatusUseCase`, `PoolHoldStatusUseCase`, ...) | 12 | 66 | 66 |
| 10 use-case `__init__` constructors (`SelectGuidanceUseCase`, `ResolveLogUseCase`, `ScheduleResolver`, `AddProjectUseCase`, `ScanProjectsUseCase`, `RestoreStoreUseCase`, ...) | 10 | 45 | 45 |
| 7 `Config` accessors (`github_poll_seconds`, `poll_seconds`, `review_rounds_cap`, `spin_cap`, `tick_failure_cap`, `worker_history`, ...) | 7 | 21 | 21 |
| 6 use-case `__init__` constructors (`ReportGuidanceUseCase`, `GuidanceSyncUseCase`, `LiveUsageAccrualUseCase`, ...) | 6 | 15 | 15 |

The two largest components are the 22 `Config` accessors and the 12 constructors (`ReflectUseCase.__init__` through `PoolHoldStatusUseCase.__init__`). The four largest components hold 363 of the 533 findings. The status `save` family is a component of 5 (`config_reload_status`, `github_budget_status`, `guidance_sync_status`, `memory_gate_status`, `spin`), 10 edges.

## 4. Gate grid

Threshold 0.82. Cells show findings, then components.

| min_lines \ min_nodes | 20       | 40       | 60       |
| --------------------- | -------- | -------- | -------- |
| 4                     | 533 / 68 | 435 / 63 | 311 / 43 |
| 6                     | 91 / 39  | 91 / 39  | 71 / 35  |
| 8                     | 39 / 22  | 39 / 22  | 39 / 22  |

The baseline cell (4, 20) is 533, as in the baseline section. At `min_lines` 5 and `min_nodes` 20 there are 208 findings in 57 components. `min_lines` is the strong gate; `min_nodes` above 20 only matters below 6 lines.

## 5. Threshold row (non-gating)

At `min_lines` 4 and `min_nodes` 20:

| Threshold | Findings | Components |
| --------- | -------- | ---------- |
| 0.7       | 752      | 110        |
| 0.82      | 533      | 68         |
| 0.9       | 486      | 45         |
| 0.95      | 482      | 43         |

Almost all findings score above 0.9 because identifiers and literals normalise away, so the threshold is not the lever.

## Corpus

`fixtures/duplication/corpus/` holds one small repository per language with planted copies, planted near-copies, non-copies and a four-member accessor family, listed in `manifest.json`. `sensors/tests/test_duplication_corpus.py` checks every pair at the default settings. Building it showed that a copy whose only difference is returning `{}` instead of `None` is not reported, since the literal kinds differ after normalisation. The accessor families are marked `reported` as a known false-positive class; the follow-up may flip them.

## Recommendation

**change.** Keep the method and change how it reports.

The method is sound: no sampled finding was wrong, and it finds renamed copies that a token detector cannot. The count is the problem: 15% of the sample (6 of 40) is a copy worth merging, and 533 pairwise findings are 68 families.

1. Report a family of mutually similar functions as one finding (connected components, since every component here is a clique). This cuts 533 to 68 with no loss of coverage, and it makes the status-adapter `save` family one finding with five members.
2. Raise the `min_lines` default to 5 or 6 once clustering is in. At 6 the count falls to 91 findings in 39 families, but it also loses the four-to-five-line real copies in the sample (4 of the 6), so clustering should land first and the gate be chosen after seeing its effect.
3. Leave `min_nodes` at 20 and the threshold at 0.82; neither moves the count much.
4. Normalisation stays. Treat accessor and constructor families as a known false-positive class and consider excluding functions that only assign, or only return a looked-up value.

File the follow-up as a separate backlog item: "Cluster duplication findings into families and revisit the `min_lines` default". It is not done here.
