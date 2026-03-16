#!/bin/bash
# ──────────────────────────────────────────────────────────────
# Spaces SSH AuthorizedKeysCommand
# Called by sshd on every SSH login to dynamically return authorized keys.
#
# sshd_config usage:
#   AuthorizedKeysCommand /opt/spaces/bin/ssh-auth-keys.sh %u
#   AuthorizedKeysCommandUser nobody
#
# Arguments:
#   $1 - the SSH username being authenticated
#
# Outputs the Spaces service public key if the username is a valid
# Spaces shell_user in the admin database. This eliminates the need
# to manually manage ~/.ssh/authorized_keys for each user.
# ──────────────────────────────────────────────────────────────

USERNAME="$1"

if [ -z "$USERNAME" ]; then
  exit 0
fi

# Sanitize: valid Unix usernames are alphanumeric + underscore/hyphen/dot
# Reject anything else to prevent SQL injection via crafted usernames
if ! echo "$USERNAME" | grep -qE '^[a-zA-Z0-9._-]+$'; then
  exit 0
fi

# Find the .spaces directory — check common locations
SPACES_DIR=""
for candidate in /home/*/.spaces /root/.spaces /Users/*/.spaces; do
  if [ -d "$candidate" ] && [ -f "$candidate/service_key.pub" ]; then
    SPACES_DIR="$candidate"
    break
  fi
done

if [ -z "$SPACES_DIR" ]; then
  exit 0
fi

SERVICE_KEY_PUB="$SPACES_DIR/service_key.pub"
ADMIN_DB="$SPACES_DIR/admin.db"

# If no admin DB, fall back to authorizing any local user
# (community/desktop mode — single user)
if [ ! -f "$ADMIN_DB" ]; then
  if [ -f "$SERVICE_KEY_PUB" ]; then
    cat "$SERVICE_KEY_PUB"
  fi
  exit 0
fi

# Check if this username is a valid shell_user in the Spaces admin DB
# sqlite3 is required — it's installed on virtually all Linux servers
if command -v sqlite3 >/dev/null 2>&1; then
  MATCH=$(sqlite3 -readonly "$ADMIN_DB" \
    "SELECT COUNT(*) FROM users WHERE shell_user = '$USERNAME'" 2>/dev/null)

  if [ "$MATCH" -gt 0 ] 2>/dev/null; then
    cat "$SERVICE_KEY_PUB"
  fi
else
  # sqlite3 not available — fall back to always authorizing
  # (safe because sshd still requires the private key match)
  cat "$SERVICE_KEY_PUB"
fi
