# Synthetic YouTube transport fixture

Six seconds of dark gray video and a 440 Hz sine wave, generated locally for
Shiira's Electron playback tests. No YouTube content or signed media URLs are
stored here. The DASH manifest uses separate H.264 video and AAC audio files
with byte ranges, so the test exercises actual decoding, buffering and seeking.

To regenerate with FFmpeg, run inside this directory:

```sh
ffmpeg -f lavfi -i color=c=0x181818:s=320x180:r=24 -f lavfi -i sine=f=440:r=48000 -t 6 -c:v libx264 -preset ultrafast -g 48 -c:a aac -f dash -seg_duration 2 -single_file 1 -single_file_name 'fixture-$RepresentationID$.mp4' manifest.mpd
```
