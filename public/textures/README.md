# Textures

Drop image files here and they will appear in the "背景・地面" floating window.

## Layout

- `ground/` — seamless tileable textures for the floor plane (jpg, png, webp)
  - Subfolders are allowed for organization (e.g. `ground/grass/`, `ground/wood/`)
- `backgrounds/` — images used as the scene background
  - Subfolders with names containing `equirect`, `panorama`, `skybox`, or `360` are treated as 360° panoramas
  - HDR files (`.hdr`) are loaded via RGBELoader
  - Other extensions: jpg, jpeg, png, webp, avif, exr

The API endpoint that lists them is `GET /api/textures`.
