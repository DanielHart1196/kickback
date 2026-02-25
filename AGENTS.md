# Repo Agent Instructions

- If the user says `gp`, run:
  1. `git add .`
  2. `git commit -m "<assistant-chosen message>"`
  3. `git push origin main`
- Choose a concise commit message based on the current diff.
- If there are no staged changes after `git add .`, skip commit and still run `git push origin main`.
