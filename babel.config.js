module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      [
        'module-resolver',
        {
          alias: {
            '@core': './src/core',
            '@data': './src/data',
            '@domain': './src/domain',
            '@platform': './src/platform',
            '@ui': './src/ui',
          },
        },
      ],
    ],
  };
};
