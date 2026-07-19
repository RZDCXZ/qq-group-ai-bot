#!/bin/sh

set -eu

qq_binary="/Applications/QQ.app/Contents/MacOS/QQ"
napcat_config_dir="${HOME}/Library/Containers/com.tencent.qq/Data/Library/Application Support/QQ/NapCat/config"
napcat_account="${NAPCAT_QQ_ACCOUNT:-}"

if [ ! -x "$qq_binary" ]; then
  echo "未找到 QQ：$qq_binary" >&2
  exit 1
fi

if [ -z "$napcat_account" ]; then
  set -- "$napcat_config_dir"/onebot11_*.json
  if [ "$1" = "$napcat_config_dir/onebot11_*.json" ]; then
    echo "未找到 NapCat 小号配置，请设置 NAPCAT_QQ_ACCOUNT 后重试。" >&2
    exit 1
  fi
  if [ "$#" -ne 1 ]; then
    echo "发现多个 NapCat 账号，请设置 NAPCAT_QQ_ACCOUNT 指定小号。" >&2
    exit 1
  fi
  napcat_account=${1##*/onebot11_}
  napcat_account=${napcat_account%.json}
fi

case "$napcat_account" in
  "" | *[!0-9]*)
    echo "NAPCAT_QQ_ACCOUNT 必须是纯数字 QQ 号。" >&2
    exit 1
    ;;
esac

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec node "$script_dir/launch-napcat.mjs" "$napcat_account"
