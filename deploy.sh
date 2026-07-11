#!/usr/bin/env bash
# One-shot deploy of ShrutiUPSC to GitHub Pages (free, HTTPS, installable PWA).
# Run AFTER `gh auth login`.
set -e
export PATH="/opt/homebrew/bin:$PATH"
cd "$(dirname "$0")"
REPO="upsc-audiobook"

if ! gh auth status >/dev/null 2>&1; then
  echo "You're not logged in yet. First run:"
  echo "    gh auth login        (GitHub.com  →  HTTPS  →  Login with a web browser)"
  echo "Then run ./deploy.sh again."
  exit 1
fi

OWNER=$(gh api user -q .login)

# Commit any pending changes
git add -A
git diff --cached --quiet || git -c user.email="$(gh api user -q .email 2>/dev/null || echo you@example.com)" \
  -c user.name="$OWNER" commit -q -m "Update ShrutiUPSC"

# Create the repo (or reuse it) and push
if gh repo view "$OWNER/$REPO" >/dev/null 2>&1; then
  git remote get-url origin >/dev/null 2>&1 || git remote add origin "https://github.com/$OWNER/$REPO.git"
  git push -u origin main
else
  gh repo create "$REPO" --public --source=. --remote=origin --push
fi

# Enable GitHub Pages on main branch, root folder
gh api -X POST "repos/$OWNER/$REPO/pages" -f "source[branch]=main" -f "source[path]=/" >/dev/null 2>&1 \
  || gh api -X PUT "repos/$OWNER/$REPO/pages" -f "source[branch]=main" -f "source[path]=/" >/dev/null 2>&1 \
  || true

echo ""
echo "✅  Pushed. GitHub Pages will finish building in ~1 minute."
echo "🔗  Your permanent link:  https://$OWNER.github.io/$REPO/"
echo "    Open it on your phone → Add to Home Screen → works offline."
