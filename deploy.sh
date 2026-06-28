#!/bin/bash
# deploy.sh — Janos Control
# Uso: ./deploy.sh "descripción del cambio"

REPO_DIR="$HOME/janos-control"  # ← cambiá esto si tu repo está en otra carpeta

cd "$REPO_DIR" || { echo "❌ No se encontró la carpeta del repo en $REPO_DIR"; exit 1; }

MSG=${1:-"update"}

git add -A
git commit -m "$MSG"
git push origin main

echo ""
echo "✅ Pusheado. Vercel está redesplegrando..."
echo "🔗 https://janos-control.vercel.app"
