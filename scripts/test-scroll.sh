#!/bin/bash
# Test script to generate lots of terminal output and trigger scroll behavior
# Run this in a Spaces pane to test if the viewport stays stable

echo "=== Scroll Stability Test ==="
echo ""
echo "This will generate 200 lines of output."
echo "While it's printing, scroll UP to read earlier lines."
echo "If the viewport stays where you scrolled, the fix works."
echo "If it jumps to the top or bottom, the fix is broken."
echo ""
echo "Starting in 3 seconds..."
sleep 3

for i in $(seq 1 200); do
  echo "[$i/200] $(date +%H:%M:%S.%N) - The quick brown fox jumps over the lazy dog. Lorem ipsum dolor sit amet, consectetur adipiscing elit."
  sleep 0.05
done

echo ""
echo "=== Test Complete ==="
echo "Did the viewport stay where you scrolled? If yes, the scroll fix is working."
