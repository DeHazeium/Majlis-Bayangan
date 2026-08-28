# Majlis Bayangan: Protokol Kudeta — Full System

## Default role distribution for 35 players

| Faction | Role | Count | Ability |
|---|---|---:|---|
| Majlis Bayangan | Majlis Bayangan | 9 | Submit one collective silence vote during each KUDETA |
| Majlis Bayangan | Penyekat Bayangan | 1 | Joins the Shadow vote and may block one special power once per game |
| Council | Ahli Majlis | 18 | Observe, discuss, complete a cover mission, and vote |
| Council | Penyiasat Majlis | 3 | Investigate one active participant once per game |
| Council | Pengawal Majlis | 3 | Protect one active participant once per game |
| Council | Pemulih Majlis | 1 | Restore one silenced participant once per game |

If attendance changes, the app keeps 10 Shadows and the seven Council special roles. Every confirmed attendee enters the same random draw; the remaining seats become Ahli Majlis. Shadow placement is balanced across occupied tables while keeping a Council majority at each table.

## Game sequence

### 1. Registration

- Participants register their real name and table using their own phone.
- The Overseer signs in as `F4nz2005` with the private Firebase password.
- The Overseer confirms attendance and locks the final list.
- The app randomizes all roles, missions, clues, and Shadow teammates.

### 2. KULIAH

- The room continues normally during dinner.
- Every active participant receives an identical-looking **Arahan Kuliah**.
- Shadows receive one of ten real infiltration missions.
- Council members receive one of 25 natural camouflage missions and a private clue.
- Completing a mission early unlocks the Council clue immediately.
- Any Council clue not yet unlocked becomes available when KONSENSUS begins.
- Mission completion does not remove or strengthen a night power.

### 3. KUDETA

- The Overseer starts a three-minute timer.
- Every active Shadow privately submits a silence target.
- Penyekat, Penyiasat, Pengawal, and Pemulih may use their once-per-game power.
- A submission can be changed until the Overseer resolves KUDETA.
- The Shadow target is chosen by plurality. A tie means no successful Shadow target.
- Protection cancels the Shadow silence on the protected target.
- A blocked special action fails but is not consumed; Penyekat's block is consumed.
- Investigation results are visible only to the Penyiasat who used the power.
- A successful restoration returns a silenced player to active status.
- After resolution, the result is announced publicly and KONSENSUS begins.

### 4. KONSENSUS

- The Overseer starts a five-minute timer.
- Active participants discuss aloud.
- Each active participant privately votes using their phone.
- Votes may be changed while voting remains open.
- Silenced participants cannot speak, vote, complete missions, or use powers.
- The participant with the unique highest number of votes is silenced.
- A tie means nobody is silenced.
- If neither faction wins, the next KULIAH round begins.

## Victory conditions

- **Council victory:** no active Majlis Bayangan members remain.
- **Majlis Bayangan victory:** active Shadows equal or outnumber all active Council members. Equality counts because the Shadows control at least half of every remaining vote.
- The app checks victory automatically after every resolved KUDETA and KONSENSUS.

## Overseer controls

- Confirm and lock attendance.
- Randomize roles once.
- Start KULIAH manually.
- Start KUDETA with a three-minute timer.
- Resolve all KUDETA actions.
- Start KONSENSUS with a five-minute timer.
- Close voting and resolve the ballot.
- View roles, active/silenced status, power usage, and submission totals.
- Reset the entire game only after two separate confirmation dialogs.

## Reset behavior

The first dialog asks whether the Overseer wants to continue. The second dialog warns that the game cannot be recovered. Confirming the second dialog removes:

- registrations and attendance;
- roles and Shadow teams;
- missions and clues;
- votes and KUDETA actions;
- used powers and investigation results;
- silenced status, round history, timers, and victory state.

The app then returns to open registration for a completely new game.

## Fair-play safeguards

- No mission requires money, food handling, touching phones, or taking personal belongings.
- Photography requires consent.
- No target can be forced or pressured to participate.
- All mission cards use the same visual treatment.
- Participant phones can read only their own private role record.
- Public data contains names, tables, active/silenced status, phase, timer, and public results—but never secret roles.
- Interim vote totals and KUDETA targets are hidden from participants.

