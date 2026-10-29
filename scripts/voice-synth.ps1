# Synthesizes the voice-check phrases to 16 kHz mono WAVs with Windows SAPI (test audio only).
param([string]$Dir = "$env:TEMP\voice")
Add-Type -AssemblyName System.Speech
New-Item -ItemType Directory -Force $Dir | Out-Null
$phrases = @{ ninja = "add a ninja"; rain = "make it rain"; turtles = "add some turtles"; lava = "add a lava pit" }
foreach ($k in $phrases.Keys) {
  $s = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
  $s.SetOutputToWaveFile((Join-Path $Dir "$k.wav"), $fmt)
  $s.Speak($phrases[$k]); $s.Dispose()
}
