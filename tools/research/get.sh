#!/bin/bash
# get.sh URL OUTFILE — fetch a page on the user's behalf, identifying honestly as Claude-User
curl -sS -L --compressed --max-time 40 -A 'Claude-User (+https://support.anthropic.com/en/articles/8896518)' -H 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' -o "$2" -w '%{http_code} %{size_download} '"$1"'\n' "$1"
