**Various utility functions used in Merlin's Maps.**

- 'Connect to Merlin' mode, which allows us to stream realtime video from Merlin VTT (an Unreal Engine app using PixelStreaming) to Foundry's background. Video and weather settings in Merlin can be controlled from Foundry.
- Custom inter-scene teleport
- Control buttons for conveniently switching between scene background presets (e.g. Night, Rain, Video versions of the same scene background)
- Fog masking using custom textures
- Keep track of all tokens' previous positions
- Keep track of tokens controlled by the GM
- Add a custom 'point of interest' tile with a toggle control
- Add two custom fields to lights that runs code or shows/hides a tile when the light is switched
- Automatically regenerate missing thumbnails on scene load (this is a problem when loading scenes from compendium adventures)

## Third-party software

Merlin's live video stream support bundles Epic Games' Pixel Streaming frontend library (MIT) and its dependencies (MIT, Apache-2.0, BSD-3-Clause) in `lib/pixelstreamingfrontend.js`. Their license texts are in `lib/THIRD_PARTY_LICENSES.txt`.
