import React from 'react';
import { Meta, Story } from '@storybook/react';
import HeatmapLayer from './HeatmapLayer';

// Mock data
const mockVolumeData = [
  { range: [-5, -1], volume: 40000 },
  { range: [-1, 1], volume: 60000 },
  { range: [1, 2], volume: 15000 },
  { range: [2, 4], volume: 10000 },
  { range: [5, 10], volume: 15000 }
];

export default {
  title: 'Components/HeatmapLayer',
  component: HeatmapLayer,
  argTypes: {
    innerWidth: { control: 'number' },
    innerHeight: { control: 'number' },
    volumeData: { control: 'object' },
    heatmapEnabled: { control: 'boolean' },
    plotMin: { control: 'number' },
    plotMax: { control: 'number' },
  },
} as Meta;

const Template: Story<{
  innerWidth: number;
  innerHeight: number;
  volumeData: Array<{ range: [number, number]; volume: number }>;
  heatmapEnabled: boolean;
  plotMin: number;
  plotMax: number;
}> = (args) => <HeatmapLayer {...args} />;

export const Default = Template.bind({});
Default.args = {
  innerWidth: 600,
  innerHeight: 200,
  volumeData: mockVolumeData as { range: [number, number]; volume: number; }[],
  heatmapEnabled: true,
  plotMin: 0,
  plotMax: 50,
};

export const NoData = Template.bind({});
NoData.args = {
  innerWidth: 600,
  innerHeight: 200,
  volumeData: [],
  heatmapEnabled: false,
  plotMin: 0,
  plotMax: 50,
};

export const DifferentDimensions = Template.bind({});
DifferentDimensions.args = {
  innerWidth: 800,
  innerHeight: 400,
  volumeData: mockVolumeData as { range: [number, number]; volume: number; }[],
  heatmapEnabled: true,
  plotMin: 0,
  plotMax: 50,
};