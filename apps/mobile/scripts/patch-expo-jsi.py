"""Xcode 26.3 (newest on GitHub's Intel Mac runners) reports one line of expo-modules-jsi 58 as
"sending 'slot' risks causing data races". The package's own UncheckedSendable helper is the fix it
uses elsewhere; apply it to that one capture. Safe to run twice."""
import sys
p = 'node_modules/expo-modules-jsi/apple/Sources/ExpoModulesJSI/Runtime/Values/JavaScriptObject.swift'
s = open(p).read()
old = """    try runtime._withUnsafeGuaranteedRef { runtime in
      try JavaScriptActor.assumeIsolated {
        try encode(JavaScriptValue.Slot(slot), runtime)"""
new = """    let sendableSlot = UncheckedSendable(slot)
    try runtime._withUnsafeGuaranteedRef { runtime in
      try JavaScriptActor.assumeIsolated {
        try encode(JavaScriptValue.Slot(sendableSlot.value), runtime)"""
if new in s:
    print('already patched')
elif old in s:
    open(p, 'w').write(s.replace(old, new)); print('patched', p)
else:
    sys.exit('expo-modules-jsi changed: patch no longer matches ' + p)
