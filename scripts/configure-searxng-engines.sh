#!/usr/bin/env bash
set -euo pipefail

CONFIG_PATH="${SEARXNG_SETTINGS_PATH:-}"

if [[ -z "$CONFIG_PATH" ]]; then
  candidates=(
    "/etc/searxng/settings.yml"
    "/usr/local/searxng/settings.yml"
    "/usr/local/searxng/searx/settings.yml"
    "/usr/local/src/searxng/searx/settings.yml"
  )
  for candidate in "${candidates[@]}"; do
    if [[ -f "$candidate" ]]; then
      CONFIG_PATH="$candidate"
      break
    fi
  done
fi

if [[ -z "$CONFIG_PATH" || ! -f "$CONFIG_PATH" ]]; then
  echo "Could not find the active SearXNG settings.yml."
  echo "Set SEARXNG_SETTINGS_PATH to the active file and rerun this command."
  exit 1
fi

echo "Using SearXNG config: $CONFIG_PATH"
backup="${CONFIG_PATH}.geoweedo-backup-$(date +%Y%m%d-%H%M%S)"
cp -a "$CONFIG_PATH" "$backup"
echo "Backup created: $backup"

python3 - "$CONFIG_PATH" <<'PY'
from pathlib import Path
import re
import sys

path = Path(sys.argv[1])
text = path.read_text()
lines = text.splitlines()

wanted = ["bing", "mojeek", "qwant", "yahoo", "yep", "wiby", "mwmbl"]


def top_level_key(line: str) -> bool:
    if not line or line[0].isspace() or line.lstrip().startswith("#"):
        return False
    return bool(re.match(r"^[A-Za-z0-9_.-]+\s*:", line))


def engine_name(line: str):
    match = re.match(r"^(\s*)-\s+name\s*:\s*(.+?)\s*$", line)
    if not match:
        return None
    raw = match.group(2).split("#", 1)[0].strip().strip("\"'")
    return raw.lower(), len(match.group(1))

# Locate the top-level engines block.
start = next((i for i, line in enumerate(lines) if re.match(r"^engines\s*:\s*(?:#.*)?$", line)), None)

if start is None:
    if lines and lines[-1].strip():
        lines.append("")
    lines.append("engines:")
    for name in wanted:
        lines.extend([f"  - name: {name}", "    disabled: false"])
else:
    end = len(lines)
    for i in range(start + 1, len(lines)):
        if top_level_key(lines[i]):
            end = i
            break

    # Record item ranges within the engines block before mutating it.
    items = []
    item_starts = []
    for i in range(start + 1, end):
        parsed = engine_name(lines[i])
        if parsed:
            item_starts.append((i, parsed[0], parsed[1]))

    for pos, (item_start, name, indent) in enumerate(item_starts):
        item_end = item_starts[pos + 1][0] if pos + 1 < len(item_starts) else end
        items.append((item_start, item_end, name, indent))

    # Work from bottom to top so insertions do not invalidate earlier indexes.
    found = set()
    for item_start, item_end, name, indent in reversed(items):
        if name not in wanted:
            continue
        found.add(name)
        disabled_index = None
        for i in range(item_start + 1, item_end):
            if re.match(r"^\s+disabled\s*:", lines[i]):
                disabled_index = i
                break
        value_line = " " * (indent + 2) + "disabled: false"
        if disabled_index is None:
            lines.insert(item_start + 1, value_line)
            end += 1
        else:
            comment = ""
            if "#" in lines[disabled_index]:
                comment = "  #" + lines[disabled_index].split("#", 1)[1]
            lines[disabled_index] = value_line + comment

    # Recompute the end of the engines block after edits.
    end = len(lines)
    for i in range(start + 1, len(lines)):
        if top_level_key(lines[i]):
            end = i
            break

    missing = [name for name in wanted if name not in found]
    additions = []
    for name in missing:
        additions.extend([f"  - name: {name}", "    disabled: false"])
    if additions:
        lines[end:end] = additions

path.write_text("\n".join(lines) + "\n")
print("Enabled SearXNG fallback engines: " + ", ".join(wanted))
PY

# Validate YAML syntax when PyYAML is available; restore the backup on failure.
if python3 -c 'import yaml' >/dev/null 2>&1; then
  if ! python3 - "$CONFIG_PATH" <<'PY'
import sys, yaml
with open(sys.argv[1], "r", encoding="utf-8") as handle:
    yaml.safe_load(handle)
PY
  then
    echo "YAML validation failed; restoring backup."
    cp -a "$backup" "$CONFIG_PATH"
    exit 1
  fi
  echo "YAML validation passed."
fi

if systemctl is-active --quiet uwsgi 2>/dev/null; then
  echo "Restarting uWSGI..."
  systemctl restart uwsgi
elif systemctl is-active --quiet searxng 2>/dev/null; then
  echo "Restarting SearXNG..."
  systemctl restart searxng
else
  echo "Warning: neither uwsgi nor searxng service is active; config was updated but no search service was restarted."
fi

if systemctl is-active --quiet nginx 2>/dev/null; then
  nginx -t
  systemctl reload nginx
fi

echo "SearXNG engine configuration complete."
