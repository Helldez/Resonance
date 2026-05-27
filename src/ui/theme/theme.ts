import { MD3LightTheme, MD3DarkTheme } from 'react-native-paper';
import { ThemeConfig } from '@core/config/ThemeConfig';

export const lightTheme = {
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    primary: '#3a6ea5',
  },
};

export const darkTheme = {
  ...MD3DarkTheme,
  colors: {
    ...MD3DarkTheme.colors,
    background: ThemeConfig.dark.background,
    surface: ThemeConfig.dark.surface,
    surfaceVariant: ThemeConfig.dark.surfaceVariant,
    primary: ThemeConfig.dark.primary,
    onPrimary: ThemeConfig.dark.onPrimary,
    onSurface: ThemeConfig.dark.onSurface,
    onSurfaceVariant: ThemeConfig.dark.onSurfaceVariant,
    outline: ThemeConfig.dark.outline,
    error: ThemeConfig.dark.error,
  },
};
