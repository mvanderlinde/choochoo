# Choo Choo Train

A casual 3D train ride for toddlers, built with Three.js. There's no score and no way to fail.

The world is procedurally generated and endless, and every visit makes a new one. The track keeps branching ahead of the train through hills, forests, lakes and mountains, and a station with a little town turns up every few hundred metres. Stop at a platform and passengers get off and walk into the station, while the people waiting on the platform walk over and board.

Where the land rises high above the track, the train goes through a tunnel with stone portals, and the camera moves to the front of the engine so you can see the way through. Where the land drops away, it crosses a red girder bridge on stone piers.

The weather changes as you go: sunny, cloudy, rain or snow falling. In cold regions the ground, trees and roofs are white and the lakes freeze, sometimes under a snowfall and sometimes under blue sky. An icon in the top-right corner shows the weather.

Roads cross the track at level crossings, with cars, trucks and buses driving on them. The crossing lights and arms only come on when you press SPACE (the same button as the horn). If you don't, the traffic keeps crossing, and any car the train hits gets squashed flat. Once the train has passed it pops back up with a boing and drives off.

## Run
```
cd train-game
python3 -m http.server 8765
```
Then open http://localhost:8765 and click (or press any key) to start. Sound needs that first click.
Add `?seed=123` to the URL to replay a particular world.

## Controls
| Key | Action |
|---|---|
| ↑ | Go faster (the train keeps cruising when you let go) |
| ↓ | Slow down / stop. A tap when "Station! Press ⬇" shows makes the train glide in and stop at the platform |
| ← / → | Pick which way to go at the next junction (shown by the green arrow signs and the on-screen arrows) |
| Space | Toot toot! It also turns on the lights and lowers the arms at the next level crossing |
| Any letter | Ding a bell |
| C | Change camera (chase / orbit / cab / high) |
| F | Fullscreen |

## Code map
- `src/heights.js`: the endless height field (hills, mountain regions, lakes) plus shared math
- `src/tracks.js`: endless track generator (branching tree built about 1.5 km ahead, pruned behind) and junction signs
- `src/terrain.js`: 200 m terrain tiles built around the train, each with trees, rocks and town buildings
- `src/structures.js`: tunnels (portals and lining) and bridges (deck, piers and abutments), and where they go
- `src/weather.js`: rain and snow, plus the sky, fog, light, clouds and frozen lakes, following the climate regions in `heights.js`
- `src/roads.js`: roads, level crossings (lights and arms), and the cars, trucks and buses, including squashing
- `src/stations.js`: stations, platforms, towns and little people, plus the passenger boarding logic
- `src/train.js`: moves the cars along the track, handles junction choice, passengers, steam puffs
- `src/models.js`: steam locomotive, tender and coaches built from Three.js shapes
- `src/world.js`: sky, water and clouds that follow the camera
- `src/audio.js`: horn, chuffing, bell (synthesized, no audio files)
- `src/main.js`: renderer, lights, input, camera, main loop

Everything is procedural, so no asset downloads are needed. Station announcements use the browser's built-in speech voice. Three.js loads from the jsDelivr CDN, which means you need an internet connection.
