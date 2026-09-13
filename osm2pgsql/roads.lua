-- Roads-only osm2pgsql flex style for the boundary-snapping service.
--
-- The reason this exists rather than reusing bpo-postcode-osm's Nominatim database: Nominatim is
-- a geocoder, so its import keeps what people can search for by name and discards the rest. An
-- unnamed track or footpath never reaches placex at all -- geometry included. Those are exactly
-- what a rural beat boundary tends to follow, and snapping needs the line, not the label.
--
-- So: every way whose highway tag is in HIGHWAY_CLASSES is kept, named or not.

local HIGHWAY_CLASSES = {
    -- Vehicle roads, major to minor.
    motorway = true, motorway_link = true,
    trunk = true, trunk_link = true,
    primary = true, primary_link = true,
    secondary = true, secondary_link = true,
    tertiary = true, tertiary_link = true,
    unclassified = true,
    residential = true,
    living_street = true,
    service = true,
    busway = true,
    road = true, -- highway=road means "unknown class", not "not a road"
    -- Unpaved and non-vehicle ways. Usually unnamed, and the whole reason for this import.
    track = true,
    path = true,
    footway = true,
    pedestrian = true,
    cycleway = true,
    bridleway = true,
    steps = true,
}

local roads = osm2pgsql.define_way_table('roads', {
    { column = 'highway', type = 'text', not_null = true },
    { column = 'name',    type = 'text' },
    { column = 'name_bn', type = 'text' },
    { column = 'ref',     type = 'text' },
    { column = 'surface', type = 'text' },
    { column = 'bridge',  type = 'boolean', not_null = true },
    { column = 'tunnel',  type = 'boolean', not_null = true },
    { column = 'geom',    type = 'linestring', projection = 4326, not_null = true },
})

local function truthy(value)
    return value == 'yes' or value == 'true' or value == '1'
end

function osm2pgsql.process_way(object)
    local highway = object.tags.highway
    if not highway or not HIGHWAY_CLASSES[highway] then
        return
    end

    -- A closed way is normally still a line to snap to (a roundabout, a service loop around a
    -- market). area=yes is the exception: it marks a pedestrian plaza or similar, whose outline
    -- is a polygon boundary rather than a path anyone walks along.
    if object.is_closed and object.tags.area == 'yes' then
        return
    end

    roads:insert({
        highway = highway,
        name    = object.tags.name,
        name_bn = object.tags['name:bn'],
        ref     = object.tags.ref,
        surface = object.tags.surface,
        bridge  = truthy(object.tags.bridge),
        tunnel  = truthy(object.tags.tunnel),
        geom    = object:as_linestring(),
    })
end
