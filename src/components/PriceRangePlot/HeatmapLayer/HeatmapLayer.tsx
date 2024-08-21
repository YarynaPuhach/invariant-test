import React, { useRef, useState } from 'react';
import { Popper, Typography } from '@material-ui/core';
import { colors, typography } from '@static/theme';


// Helper function to calculate concentration
const calculateConcentration = (volume: number, priceRange: [number, number]) => {
  const priceDifference = Math.abs(priceRange[1] - priceRange[0]);
  return priceDifference === 0 ? 0 : volume / priceDifference;
};


// Helper function to categorize ranges
const categorizeRanges = (ranges: { range: [number, number]; volume: number }[]) => {
  const rangesWithConcentration = ranges.map(rangeData => ({
    ...rangeData,
    concentration: calculateConcentration(rangeData.volume, rangeData.range)
  }));


  // Sort by concentration
  rangesWithConcentration.sort((a, b) => b.concentration - a.concentration);


  // Categorize into 5 groups
  const numCategories = Math.min(ranges.length, 5);
  const categorizedRanges = rangesWithConcentration.map((rangeData, index) => ({
    ...rangeData,
    category: Math.floor(index * numCategories / ranges.length)
  }));


  return categorizedRanges;
};


// HeatmapLayer component
const HeatmapLayer = ({
  innerWidth,
  innerHeight,
  volumeData = [],
  heatmapEnabled = false,
  plotMin,
  plotMax,
}: {
  innerWidth: number;
  innerHeight: number;
  volumeData?: Array<{ range: [number, number]; volume: number }>;
  heatmapEnabled?: boolean;
  plotMin: number;
  plotMax: number;
  }) => {
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const [tooltipContent, setTooltipContent] = useState('');
  const [tooltipPosition, setTooltipPosition] = useState<{ top: number; left: number } | null>(null);


  const areaRef = useRef<SVGSVGElement>(null);


  const handleMouseMove = (event: React.MouseEvent) => {
    const { clientX } = event;
    const rect = areaRef.current?.getBoundingClientRect();
    if (rect) {
      const top = rect.top -30;
      const left = clientX - 30;
      setTooltipPosition({ top, left });
    }
  };


  const handleTooltipOpen = (content: string) => {
    setTooltipContent(content);
    setTooltipOpen(true);
  };


  const handleTooltipClose = () => {
    setTooltipOpen(false);
  };


  if (!heatmapEnabled || !volumeData.length) {
    return null;
  }


  const categorizedRanges = categorizeRanges(volumeData);
  const unitLen = innerWidth / (plotMax - plotMin);


  return (
    < >
      <svg
        className="heatmap"
        width={innerWidth}
        height={innerHeight}
        ref={areaRef}
        onMouseMove={handleMouseMove}
        style={{ position: 'relative' }}
      >
        {categorizedRanges.map(({ range, volume, category }, idx) => {
          const minRange = Math.min(range[0], range[1]);
          const maxRange = Math.max(range[0], range[1]);


          const x = (minRange - plotMin) * unitLen;
          const width = (maxRange - minRange) * unitLen;


          const fillOpacity = 0.2 + (category / 4) * 0.8;


          return (
            <g key={idx}>
              <rect
                x={x}
                width={width}
                height={innerHeight}
                fill={colors.invariant.green}
                opacity={fillOpacity}
                onMouseEnter={() => handleTooltipOpen(`Volume: ${volume.toLocaleString()}`)}
                onMouseLeave={handleTooltipClose}
              />
            </g>
          );
        })}
      </svg>
      {tooltipPosition && (
        <Popper
          open={tooltipOpen}
          anchorEl={null}
          style={{
            position: 'absolute',
            top: tooltipPosition.top,
            left: tooltipPosition.left,
            backgroundColor: colors.invariant.light,
            borderRadius: '8px',
            zIndex: 1300, 
            ...typography.caption3,
            color: colors.white.main,
            padding: '3px 9px',
            letterSpacing:'-3%'
          }}
        >
          <div>
            <Typography>{tooltipContent}</Typography>
          </div>
        </Popper>
      )}
    </>
  );
};


export default HeatmapLayer;