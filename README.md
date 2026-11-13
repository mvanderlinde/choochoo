# Choo Choo Train

A casual 3D train ride for toddlers, built with Three.js. There's no score and no way to fail.

The world is procedurally generated and endless, and every visit makes a new one. The track keeps branching ahead of the train through hills, forests, lakes and mountains, and a station with a little town turns up every few hundred metres. Stop at a platform and passengers get off and walk into the station, while the people waiting on the platform walk over and board.

Where the land rises high above the track, the train goes through a tunnel with stone portals, and the camera moves to the front of the engine so you can see the way through. Where the land drops away, it crosses a red girder bridge on stone piers.

The world is made of big biomes, roughly a minute of riding each, that blend into one another:

- **Meadow:** green hills, lakes and woods.
- **Autumn:** orange, red and yellow trees, birches and leaves tumbling down.
- **Winter:** snow on the ground, snowy trees and frozen lakes.
- **Christmas:** decorated Christmas trees, snowmen and lots of snowfall. Its towns are the North Pole: red, green and gingerbread houses with coloured lights, a striped North Pole signpost, a giant Christmas tree with presents, candy canes, Santa's Workshop, and reindeer (including one with a red nose) with Santa's sleigh.
- **Swamp:** murky pools, willows, dead trees, reeds, lily pads and mist.
- **Rainforest:** big jungly hills, palms, ferns and frequent rain.
- **Mountains:** each mountain region is a big massif, and the line climbs right up its slopes on steep grades, with drops beside the track, viaducts over gullies, and tunnels through the peaks that stick up. The upper slopes are snowy. Its towns are ski villages: wooden chalets with balconies and steep snowy roofs, a chairlift with people riding up the mountain, and skiers zig-zagging down the run beside it.
- **Ocean:** the line follows a long beach beside the open sea, with palms, sailboats and lighthouses.

Station names suit the biome they're in: Pumpkin Patch in autumn, Jingle Bell Junction at Christmas, Froggy Falls in the swamp, Toucan Town in the rainforest, Eagle Peak in the mountains, Seashell Shore by the sea, and so on.

The weather changes as you go: sunny, cloudy, rain or snow falling. Some biomes are wetter than others. An icon in the top-right corner shows the weather and the biome.

The train gets dirtier the further it goes, with mud and soot building up from the wheels, faster through swamps and rainforests. Rain slowly washes it clean again and leaves it shiny and wet for a while.

Every so often the line runs past a train depot (anywhere but up in the mountains: by the sea the yard is always on the land side, and in the swamp it's built up on an embankment above the pools). It's a big yard full of sidings and parked passenger and freight trains, with engines peeking out of the engine shed. It also has a water tower, a coal stage, stacks of containers, and a turntable that slowly spins an engine round while a little shunting engine trundles up and down.

You can drive into a depot too: just before the yard the line splits, and picking that way takes the train along the first siding and through the train wash, then back onto the main line. The train slows down on its own as it gets close, and the camera moves to watch it roll through the spinning brushes, spray and bubbles. Each car comes out clean and shiny. Depots are rare while the train is clean, but once it's really dirty they turn up much more often, about every kilometre and a half.

Day turns to night about every six minutes. At dusk the sky glows orange, then the stars and moon come out. The engine's headlamp, the coach windows and the red tail lamp switch on, along with car and bus headlights, platform lamps and town windows. They all switch off again at dawn. The engine's headlamp also comes on inside tunnels.

Roads cross the track at level crossings, with cars, trucks and buses driving on them. The crossing lights and arms only come on when you press SPACE (the same button as the horn). If you don't, the traffic keeps crossing, and any car the train hits gets squashed flat. Once the train has passed it pops back up with a boing and drives off.

## Run
```
cd train-game
python3 -m http.server 8765
```
Then open http://localhost:8765 and click (or press any key) to start. Sound needs that first click.
Add `?seed=123` to the URL to replay a particular world, `?hour=19` to start at a particular time of day (the default is 9 in the morning), and `?biome=ocean` to start in a particular biome (`meadow`, `autumn`, `winter`, `christmas`, `swamp`, `rainforest`, `mountain` or `ocean`).

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

On a phone or tablet, big buttons appear instead: hold the green ⬆ to go and the red ⬇ to slow down, and tap ⬅ / ➡ for the junctions, 📯 for the horn and 🎥 to change the camera. Tapping anywhere else rings the bell. Adding the page to the home screen makes it full screen. Add `?touch` to the URL to show the buttons on a computer.

## Code map
- `src/noise.js`: shared noise and math helpers
- `src/biomes.js`: the biome regions (jittered cells with blended borders) and the ocean coastlines
- `src/heights.js`: the endless height field built from the biomes (hills, peaks, swamp pools, beaches, lakes), the line's height and the climate
- `src/flora.js`: trees, plants and props for each biome, and which grow where
- `src/tracks.js`: endless track generator (branching tree built about 1.5 km ahead, pruned behind) and junction signs
- `src/terrain.js`: 200 m terrain tiles built around the train, each with biome-coloured ground, plants, rocks, lighthouses and town buildings
- `src/structures.js`: tunnels (portals and lining) and bridges (deck, piers and abutments), and where they go
- `src/depot.js`: train depots (yard layout, parked trains, shed, turntable, shunter); static parts are merged into one mesh per material
- `src/daynight.js`: the clock, sun and moon, stars, and `nightGlow()`, which fades registered lamps on at dusk and off at dawn
- `src/weather.js`: rain and snow, plus the sky, fog, light, clouds and frozen lakes, following the climate regions in `heights.js`
- `src/roads.js`: roads, level crossings (lights and arms), and the cars, trucks and buses, including squashing
- `src/stations.js`: stations, platforms, towns, station names for each biome and little people, plus the passenger boarding logic
- `src/northpole.js`: the North Pole decorations for stations in the Christmas biome
- `src/skitown.js`: the chairlift and skiers for ski villages in the mountains (the chalets are built by `terrain.js`)
- `src/train.js`: moves the cars along the track, handles junction choice, passengers, steam puffs
- `src/models.js`: steam locomotive, tender and coaches built from Three.js shapes
- `src/world.js`: sky, water and clouds that follow the camera
- `src/audio.js`: horn, chuffing, bell (synthesized, no audio files)
- `src/main.js`: renderer, lights, input, camera, main loop

Everything is procedural, so no asset downloads are needed. Station announcements use the browser's built-in speech voice. Three.js loads from the jsDelivr CDN, which means you need an internet connection.
