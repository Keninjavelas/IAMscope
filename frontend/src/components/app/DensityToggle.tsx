import type { JSX } from 'react';
import { DENSITY } from '@iamscope/tokens';
import type { DensityMode } from '@iamscope/types';
import { AlignJustify, Rows2, Rows3 } from 'lucide-react';
import { IconButton } from '@/components/ui/Button';
import { useDensity } from '@/hooks/useTheme';

const ICONS: Record<DensityMode, typeof Rows2> = {
  compact: Rows3,
  comfortable: Rows2,
  spacious: AlignJustify,
};

/**
 * Density is a feature (Plan §15.1), so it gets a one-click control. Cycling
 * keeps the control small and always shows the *current* mode in its label.
 */
export function DensityToggle(): JSX.Element {
  const { density, cycleDensity } = useDensity();
  const Icon = ICONS[density];
  const label = DENSITY[density].label;

  return (
    <IconButton
      label={`Row density: ${label}. Activate to switch to the next density.`}
      icon={Icon}
      size="sm"
      onClick={cycleDensity}
    />
  );
}
