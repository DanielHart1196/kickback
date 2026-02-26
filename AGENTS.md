# Repo Agent Instructions

- If the user says `gp`, run:
  1. `git add .`
  2. `git commit -m "<assistant-chosen message>"`
  3. `git push origin main`
- Choose a concise, descriptive commit message based on the current diff (for example: `Add PUBLIC_APP_URL for absolute link generation`).
- If there are no staged changes after `git add .`, skip commit and still run `git push origin main`.
- Never ask to run `gp`; only run it when the user says `gp`.

## Local Screenshot Paths
- Latest screenshots are typically in `/storage/emulated/0/DCIM/Screenshots/` (Android/Termux).
- Use the most recent file in that directory when the user says "latest screenshot".
