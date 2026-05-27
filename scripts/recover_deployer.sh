#!/bin/bash
# recover_deployer.sh. On launch day, run this on the deploy machine.
# Prompts for the 12-word seed phrase, derives the keypair, verifies
# the public key matches the recorded deployer pubkey, sanity-checks
# the mainnet SOL balance, then prints the export command for use
# with mainnet_launch.sh.
#
# Self-destructs the keypair file on any mismatch so a wrong seed
# never leaves a dangerous file behind.
#
# Usage on VPS:
#   ./scripts/recover_deployer.sh
#
# After OK: copy/paste the printed `export DEPLOYER_KEYPAIR=...` line,
# then run `./scripts/mainnet_launch.sh`.
set -eu

EXPECTED_PUBKEY="9ZDrkF9a8bMHPeDhe3oiDDUC1616C3vtTGozBgMxhWtn"
KEYPAIR_PATH="${KEYPAIR_PATH:-/root/deployer-keypair.json}"
MIN_BALANCE_SOL=5

if ! command -v solana-keygen >/dev/null; then
  echo "ERROR: solana-keygen not in PATH. Source the toolchain:"
  echo '  export PATH=$PATH:/root/.local/share/solana/install/active_release/bin'
  exit 2
fi

if [ -f "$KEYPAIR_PATH" ]; then
  echo "WARNING: $KEYPAIR_PATH already exists."
  echo "If you're recovering again, delete it first:"
  echo "  shred -u $KEYPAIR_PATH"
  exit 3
fi

echo "About to recover the WrappedBulls deployer keypair to:"
echo "  $KEYPAIR_PATH"
echo ""
echo "Expected pubkey: $EXPECTED_PUBKEY"
echo ""
echo "When prompted, paste the 12 word seed phrase for the deployer wallet."
echo "Press [Enter] for an empty BIP39 passphrase (we don't use one)."
echo ""
echo "==="
solana-keygen recover -o "$KEYPAIR_PATH" --force
chmod 600 "$KEYPAIR_PATH"
echo "==="
echo ""

ACTUAL=$(solana-keygen pubkey "$KEYPAIR_PATH")
echo "derived pubkey:  $ACTUAL"
echo "expected pubkey: $EXPECTED_PUBKEY"

if [ "$ACTUAL" != "$EXPECTED_PUBKEY" ]; then
  echo ""
  echo "MISMATCH. The seed you entered does not derive the recorded deployer."
  echo "Shredding the recovered file. Try again with the correct seed phrase."
  shred -u "$KEYPAIR_PATH"
  exit 4
fi
echo ""
echo "OK. pubkey matches the recorded deployer."

BALANCE=$(solana balance "$KEYPAIR_PATH" --url mainnet-beta 2>/dev/null | awk '{print $1}')
echo "mainnet balance: $BALANCE SOL"
if awk -v b="$BALANCE" -v m=$MIN_BALANCE_SOL 'BEGIN { exit (b+0 < m+0) ? 0 : 1 }'; then
  echo "WARNING: balance is below ${MIN_BALANCE_SOL} SOL. Program deploy needs ~3-4 SOL plus retry headroom."
  echo "Top up before running mainnet_launch.sh."
fi

echo ""
echo "=== READY TO LAUNCH ==="
echo "Run this in the SAME shell, then run mainnet_launch.sh:"
echo ""
echo "  export DEPLOYER_KEYPAIR=$KEYPAIR_PATH"
echo "  cd /root/wrappedbulls && ./scripts/mainnet_launch.sh"
echo ""
echo "AFTER LAUNCH SUCCESS: shred the file so the keypair doesn't sit on disk."
echo "  shred -u $KEYPAIR_PATH"
