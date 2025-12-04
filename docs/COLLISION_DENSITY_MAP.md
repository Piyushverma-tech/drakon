# Collision Density Map

## Overview

The Collision Density Map feature provides real-time visualization of crowded orbital regions and identifies potential close approaches between satellites. By computing spatial density using a voxel-based partitioning algorithm, the system highlights collision risk areas and surfaces candidate close-approach pairs for operator review.

## Feature Description

The Collision Density Map analyzes the current positions of all satellites and:

- **Identifies Crowded Regions**: Detects areas with high satellite density
- **Surfaces Close Approaches**: Finds satellite pairs within a configurable detection radius
- **Visualizes Risk**: Colors satellites based on local collision density (Cool to Warm)
- **Provides Metrics**: Displays density statistics and top close-approach candidates

## Implementation Details

### Spatial Analysis Algorithm

The density computation uses a **voxel grid partitioning** approach for efficient spatial analysis:

1. **Coordinate Conversion**: Satellite positions (lat/lon/alt) are converted to ECEF (Earth-Centered, Earth-Fixed) coordinates
2. **Voxel Partitioning**: Space is divided into 3D voxels (configurable size, typically 20-150km)
3. **Neighbor Search**: For each satellite, the algorithm examines its voxel and 26 neighboring voxels
4. **Distance Calculation**: Computes 3D Euclidean distance between satellites in the same or adjacent voxels
5. **Candidate Pair Collection**: Identifies pairs within the detection radius and sorts by distance

### Density Aggregation

- **Grid Cells**: Density is aggregated into lat/lon grid cells (configurable resolution: 2-4°)
- **Cell Counts**: Each cell stores the number of satellites within its boundaries
- **Normalization**: Density values are normalized (0-1) based on the maximum cell count
- **Filtering**: Only cells with 2+ satellites are considered to reduce noise

### Visualization

#### Satellite Coloring

When the density map is enabled, **all satellites** are colored based on their local collision density:

- **Low Density (Safe)**: Blue `rgb(80,160,255)` - Satellites in sparse regions
- **Medium-Low**: Cyan `rgb(120,210,255)`
- **Medium**: Green `rgb(60,200,140)`
- **Medium-High**: Yellow `rgb(255,255,120)`
- **High Density (Risk)**: Orange → Red `rgb(255,140,60) → rgb(255,50,50)` - Satellites in crowded regions

**Note**: This creates a clear visual distinction from normal orbit-based colors (red/orange/green), making it easy to identify collision risk areas.

#### Close Approach Lines

- **Visualization**: deck.gl `LineLayer` renders lines between candidate close-approach pairs
- **Color Coding**:
  - **Red/Pink** `[255, 80, 200]`: Pairs within half the detection radius (high risk)
  - **Amber** `[255, 200, 200]`: Pairs within full detection radius (moderate risk)
- **Line Width**: 2 pixels for visibility

### User Interface

The Collision Density Map panel includes:

#### Controls

1. **Toggle Switch**

   - Enable/disable density analysis and visualization
   - When enabled, all satellites switch to density-based coloring

2. **Detection Radius Slider**
   - Range: 10-250 km
   - Step: 5 km
   - Default: 75 km
   - Controls the distance threshold for identifying close approaches
   - Larger radius captures more potential close approaches but increases computation

#### Color Legend

- Visual gradient bar showing the color range from low (blue) to high (red) density
- Color markers with labels for quick reference
- Description explaining the density-based coloring system

#### Statistics Display

- **Hotspots**: Number of grid cells with elevated density
- **Top Pairs**: Count of candidate close-approach pairs identified
- **Peak Density**: Maximum number of satellites in a single cell
- **Detection Radius**: Current radius setting used for analysis

#### Top Close Approaches List

Displays the top 5 closest satellite pairs with:

- **Satellite IDs**: NORAD IDs of both satellites in the pair
- **Altitudes**: Individual altitudes of both satellites
- **Distance**: Formatted distance (meters for <1km, kilometers for ≥1km)
- **Color Coding**:
  - Red for pairs within half the detection radius
  - Amber for pairs within full detection radius

## Performance Optimizations

### Worker-Based Computation

- **Offloading**: All density calculations run in a Web Worker to prevent UI blocking
- **Worker Function**: `computeCollisionDensityAsync` in `lib/satelliteWorker.ts`
- **Benefits**: Maintains 60fps UI even with thousands of satellites
- **Implementation**: Comlink-based worker with async/await interface

### Debouncing

- **Debounce Delay**: 500ms on detection radius slider
- **Purpose**: Prevents excessive recomputation during slider adjustments
- **User Experience**: Smooth interaction while heavy calculations are deferred

### Efficient Data Structures

- **Voxel Grid**: O(1) lookup for spatial queries
- **Map-Based Storage**: Fast density lookups by location
- **Nearest-Neighbor Search**: Optimized search radius (1.5x cell size) for satellite-to-density matching

### Caching Strategy

- **Result Caching**: Density results are cached per `(satellite positions, radius)` combination
- **Cache Invalidation**: Automatically invalidated when satellite positions update
- **Memory Management**: Efficient storage of density cells and candidate pairs

## Technical Stack

### Core Components

- **Worker Implementation**: `lib/workers/satellite.worker.ts`

  - `computeCollisionDensity`: Main density computation function
  - `latLonAltToECEF`: Coordinate conversion utility
  - `getVoxelKey`: Voxel grid key generation
  - `getNeighborKeys`: 26-neighbor voxel lookup

- **Async Wrapper**: `lib/satelliteWorker.ts`

  - `computeCollisionDensityAsync`: Client-side async wrapper with caching

- **UI Component**: `components/SatelliteGlobe.tsx`
  - Density state management
  - Visualization layer configuration
  - Panel UI rendering

### Visualization Layers

- **ScatterplotLayer**: Main satellite layer with density-based coloring
- **LineLayer**: Close-approach pair visualization
- **Coordinate System**: `COORDINATE_SYSTEM.LNGLAT` with longitude wrapping

### Data Types

```typescript
type DensityWorkerInput = {
  id: number;
  lat: number;
  lon: number;
  altKm: number;
};

type DensityResult = {
  densityCells: Array<{
    lat: number;
    lon: number;
    count: number;
  }>;
  candidatePairs: Array<{
    idA: number;
    idB: number;
    distanceKm: number;
    altitudeA: number;
    altitudeB: number;
    latA: number;
    lonA: number;
    latB: number;
    lonB: number;
  }>;
  stats: {
    totalCells: number;
    maxCellCount: number;
    detectionRadiusKm: number;
    gridCellSizeDeg: number;
  };
};
```

## Algorithm Details

### Voxel Grid Construction

1. Determine voxel size based on detection radius (typically 20-150km)
2. Convert all satellite positions to ECEF coordinates
3. Assign each satellite to its corresponding voxel
4. Store satellite metadata (ID, position) in voxel buckets

### Close Approach Detection

For each satellite:

1. Get its voxel key
2. Retrieve 26 neighboring voxel keys (3D grid neighbors)
3. For each satellite in current + neighbor voxels:
   - Calculate 3D Euclidean distance
   - If distance < detection radius, add to candidate pairs
4. Sort candidate pairs by distance
5. Return top-K pairs (default: 50)

### Density Aggregation

1. Create lat/lon grid with configurable cell size (2-4°)
2. For each density cell, count satellites within boundaries
3. Normalize counts (0-1) based on maximum
4. Filter cells with count < 2 to reduce noise

## Usage Examples

### Identifying Crowded LEO Regions

1. Enable "Collision Density Map" toggle
2. Set detection radius to 50-75 km (typical for LEO)
3. Observe orange/red-colored satellites indicating high-density regions
4. Review "Top Close Approaches" list for specific pairs

### Screening for Close Approaches

1. Enable density map
2. Adjust detection radius based on orbit class:
   - **LEO**: 50-100 km
   - **MEO**: 100-150 km
   - **GEO**: 150-250 km
3. Examine close-approach lines on the globe
4. Click on lines or review the list for detailed information

### Monitoring Specific Altitude Shells

1. Filter satellites by altitude (using Objects Overview filters)
2. Enable density map
3. Set appropriate detection radius
4. Analyze density patterns within the selected shell

## Configuration Parameters

### Detection Radius

- **Small (10-50 km)**: Focused on very close approaches, fewer false positives
- **Medium (50-100 km)**: Balanced detection for LEO operations
- **Large (100-250 km)**: Broader screening for MEO/GEO, more candidates

### Voxel Size

Automatically calculated based on detection radius:

- Small radius (<50km): 20km voxels
- Medium radius (50-100km): 50-75km voxels
- Large radius (>100km): 100-150km voxels

### Grid Cell Size

Automatically adjusted based on detection radius:

- Small radius: 2° cells
- Medium radius: 3° cells
- Large radius: 4° cells

---

### Overall Data Flow

The system uses a Web Worker to offload heavy 3D spatial calculations, ensuring the UI remains smooth (60 FPS) even when analyzing thousands of satellites.

1. Frontend (React Component) : The SatelliteGlobe component has a list of current satellite positions.
2. Hook Trigger : The useCollisionDensity hook watches this list. When positions update (debounced), it sends a payload to the worker.
3. Worker Calculation : The worker runs the computeCollisionDensity algorithm (detailed below).
4. Result Return : The worker returns a DensityResult object containing:
   - satelliteDensities : A map of 3D density scores for each satellite.
   - candidatePairs : A list of satellite pairs that are dangerously close.
   - densityCells : (Legacy/Visualization) 2D heatmap data.
5. Visualization : The frontend receives this data and updates the globe:
   - Satellites are colored red/orange/blue based on their specific 3D density score.
   - Lines are drawn between close-approach pairs.

### Algorithm: computeCollisionDensity (In Worker)

The core logic has moved from a 2D lat/lon grid to a 3D Voxel Grid to accurately separate orbital shells (LEO vs. GEO).
Step 1: Input Preparation
The function receives a list of satellites with their current Geodetic coordinates:

- lat (Latitude)
- lon (Longitude)
- altKm (Altitude in km) Step 2: Voxel Grid Construction (Spatial Indexing)
  To avoid comparing every satellite with every other satellite (which would be $O(N^2)$ and very slow), we map them into 3D space.

1. ECEF Conversion : Each satellite's (lat, lon, alt) is converted to Earth-Centered, Earth-Fixed (ECEF) $(x, y, z)$ coordinates. This represents their true 3D position relative to Earth's center.
2. Voxel Key Generation : We divide space into 3D cubes (voxels) of a fixed size (e.g., 50km).
   - key = floor(x/size), floor(y/size), floor(z/size)
3. Bucketing : We place every satellite into a Map<string, Satellite[]> , where the key is the voxel ID. Step 3: 3D Density & Close Approach Calculation
   We iterate through every populated voxel and look at its 26 neighbors (3x3x3 grid).

For every satellite $A$ in the current voxel:

1. We look at all satellites $B$ in the current voxel and neighbor voxels.
2. Distance Check : We calculate the true 3D Euclidean distance:
   $$dist = \sqrt{(x_A-x_B)^2 + (y_A-y_B)^2 + (z_A-z_B)^2}$$
3. Threshold Filter : If $dist \le detectionRadius$ (e.g., 75km):
   - Density Score : We increment the density count for both satellite A and satellite B. This count represents "how many other objects are nearby in 3D space."
   - Candidate Pair : We record the pair $(A, B)$ as a potential collision risk.
     Crucial Improvement: Previously, we only grouped by Lat/Lon. Now, a GEO satellite at (0°N, 0°E, 35,000km) will represent a completely different voxel than a LEO satellite at (0°N, 0°E, 500km), so they will not be counted as neighbors.
     Step 4: Result Packaging
     The worker packages the results:

- satelliteDensities : A map { satelliteId: count } .
- maxSatelliteDensity : The highest count found (used for normalization).
- candidatePairs : The list of close pairs, sorted by distance.

### Frontend Consumption (useCollisionDensity)

The hook receives the result and prepares it for the UI:

1. Priority Check : It checks if satelliteDensities (the 3D data) exists.
2. Normalization : It creates a normalized map (0.0 to 1.0) for coloring.
   - normalizedValue = count / maxSatelliteDensity
3. Fallback : If 3D data is missing (e.g., old worker version), it falls back to the old 2D grid map (but this path is now effectively deprecated).

---

## Limitations and Considerations

1. **Snapshot Analysis**: Density is computed from current positions only (not predictive)
2. **TLE Accuracy**: Results depend on TLE data quality and recency
3. **Computational Cost**: Large detection radii increase computation time
4. **False Positives**: Some candidate pairs may not be actual collision risks (different orbital planes)

## Future Enhancements

Potential improvements for future versions:

- **Predictive Density**: Project density forward in time to predict future crowded regions
- **Velocity-Based Filtering**: Filter pairs by relative velocity to reduce false positives
- **Orbital Plane Filtering**: Only consider pairs in similar orbital planes
- **Historical Trends**: Track density changes over time
- **Export Capabilities**: Export density data and close-approach lists
- **Alert System**: Automatic alerts for pairs below critical distance thresholds

## Related Documentation

- [Orbital Plane Visualization](./ORBITAL_PLANE_VISUALIZATION.md)
- [Performance Optimizations](../README.md#performance--heavy-compute-offload)
