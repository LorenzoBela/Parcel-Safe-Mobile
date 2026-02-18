const { withProjectBuildGradle } = require('expo/config-plugins');

module.exports = function withAndroidKotlin(config) {
    return withProjectBuildGradle(config, (config) => {
        if (config.modResults.language === 'groovy') {
            let contents = config.modResults.contents;

            // 1. Force the classpath version if it's not already set to 2.0.21
            contents = contents.replace(
                /classpath\('org.jetbrains.kotlin:kotlin-gradle-plugin'\)/g,
                `classpath('org.jetbrains.kotlin:kotlin-gradle-plugin:2.0.21')`
            );

            // 2. Inject ext variables RELIABLY.
            if (!contents.includes('ext.kotlinVersion = "2.0.21"')) {
                contents = contents.replace(
                    /buildscript\s*\{/,
                    `buildscript {\n    ext.kotlinVersion = "2.0.21"\n    ext.kspVersion = "2.0.21-1.0.28"`
                );
            }

            // 3. Force resolution strategy using standard 'force' syntax
            if (!contents.includes('resolutionStrategy')) {
                const resolutionStrategyBlock = `
    configurations.all {
        resolutionStrategy {
            force 'org.jetbrains.kotlin:kotlin-stdlib:2.0.21'
            force 'org.jetbrains.kotlin:kotlin-reflect:2.0.21'
        }
    }
`;
                contents = contents.replace(
                    /allprojects\s*\{/,
                    `allprojects {${resolutionStrategyBlock}`
                );
            }

            config.modResults.contents = contents;
        }
        return config;
    });
};
