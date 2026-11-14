# Use cases

Recognizer is an architecture tool: it gives a person a top-down view of a codebase's structure, and of where risk sits in that structure, while most of the code is written by agents. It is built for a professional setting, where the person carries the accountability for what ships, so each use case ends in a decision that person could defend and record.

There are five intended use cases. Each is described through the same five lenses, and a feature belongs in Recognizer when it serves one of them through one of these lenses:

- **Moment**: what happens that makes the person reach for the tool, and where they are when it does.
- **Question**: the one thing they need answered.
- **Reach**: the steps from that moment to the answer. Fewer is better; one is the goal.
- **Presentation**: what they see, and whether it answers the question without interpretation.
- **Capture and feedback**: what they take away, and how it returns to the development loop.

Running a repository's gates in CI is not one of the use cases. `recognizer check` and its ratchet remain, but they are not designed for.

## Arriving at a codebase

- **Moment**: joining a team, inheriting a system, a due-diligence look, an incident in an unfamiliar area, or returning to one's own code after weeks away.
- **Question**: what are the main parts and how do they depend on each other, which are core and which are edge, where is the risk, and is there an intended architecture the code follows. On a return: what changed since the last visit.
- **Reach**: opening the folder. The first scan runs on open; describing and sensors wait until asked, because they cost money or run the tests.
- **Presentation**: an overview first: the top-level folders as frames with the dependencies between them, then drilling down. Each component carries a one-line description, a legend names what is shown, and risk shows where sensors have run. A return visit shows the change since the last one.
- **Capture and feedback**: saved views as understanding grows, notes on what surprised, and a draft policy stating the architecture the person thinks they see, which the tool checks against the code. Views, notes and policy are committed, so the next person or agent starts from that understanding.

## Before a change

- **Moment**: shaping a feature or fix before any code is written: writing a brief, sizing a ticket, or answering "how hard is this?".
- **Question**: where does this belong, what will it touch, and is that ground safe to build on: which components it lands in and whether the policy allows the dependencies it needs, how far its effects spread, and how risky the code there is.
- **Reach**: starting from words, such as "checkout payment retries", and landing on the relevant area of the map.
- **Presentation**: the area in its layers with what depends on it and what it depends on, coloured by risk. A proposed module or edge can be sketched and checked against the policy before it exists.
- **Capture and feedback**: a saved view of the area linked from the brief, notes such as "new adapter goes here" or "test this first", and brief-ready text from the view and its notes, so the person or agent who builds it starts from the same picture.

## Reviewing a change

- **Moment**: a pull request from an agent or a colleague is ready, just before approving it.
- **Question**: what does this change do to the structure, and does it add risk where it matters.
- **Reach**: one step from the pull request to its change view.
- **Presentation**: the touched modules in their layers, with the edges the change adds or removes, the policy breaks it introduces, and the findings it adds or clears against its base. A change to `.recognizer/` (config, policy or baseline) is called out, because it moves the measure rather than the code.
- **Capture and feedback**: a review comment that cites the evidence, as a link to the change view or a finding as text, which reaches whoever reworks the change: a colleague, or an agent through its feedback channel.

## Periodic steering

- **Moment**: a regular step back from single changes: a sprint's end, before a release, a retro, or when someone asks whether the codebase is healthy. Often the moment to justify structural work over features, so the result must persuade others.
- **Question**: is the structure getting better or worse, where is risk concentrating, and what is worth fixing now: drift (new policy breaks, findings above the baseline, a policy the code has outgrown), concentration by component, and priority by how often the risky code changes.
- **Reach**: one step to a comparison between the last review and now.
- **Presentation**: per component, the findings added and removed, scores moving, new edges and policy drift between two points in time, ranked by risk crossed with change frequency.
- **Capture and feedback**: improvement items naming a component and a target (such as "domain: mutation score 0.33 to 0.6"), which feed agent guidance; policy updates where the code was right; a deliberate review of the baseline; a shareable record of the comparison; and a record of the review itself, which is the next review's starting point.

## Guiding agents

- **Moment**: handing a feature to an agent, which should start in the right place under the right rules; or handing over a structural improvement found while steering or reviewing: a C.R.A.P. score to reduce, surviving mutants to kill, a layer break to fix, a hotspot to reduce.
- **Question**: for the person, whether the task is worth handing over, precise enough to be done well, and verifiably done. For the agent, where it is, what the rules are, what exactly is wrong, and whether its change fixed that without breaking the structure.
- **Reach**: for the agent, the CLI, `recognizer help agents` and the skills. For the person, one action on a finding or a component that produces the agent's task.
- **Presentation**: for the agent, exact and checkable evidence: the function and its lines, the measures, each surviving mutant with its line and operator, the fix pattern, the target, and the command that checks the result, scoped to the modules involved. For the person, before and after.
- **Capture and feedback**: the task enters the loop as a brief, an item or a feedback comment. The agent re-runs the scoped check and reports the finding's stable id cleared with before and after figures, and the fix returns as a change to review. That review shows the structure improved, not only the number, and calls out any change to `.recognizer/`, because an agent can game a measure or move its goalposts.
