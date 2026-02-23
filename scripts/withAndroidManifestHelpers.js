const { withAndroidManifest } = require('@expo/config-plugins');

const withAndroidManifestHelpers = (config) => {
    return withAndroidManifest(config, async (config) => {
        const androidManifest = config.modResults;

        // Ensure manifest has tools namespace
        if (!androidManifest.manifest.$['xmlns:tools']) {
            androidManifest.manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
        }

        const app = androidManifest.manifest.application[0];

        if (!app['meta-data']) {
            app['meta-data'] = [];
        }

        const metaDataList = app['meta-data'];
        const targetName = 'com.google.firebase.messaging.default_notification_color';
        let found = false;

        // Handle if meta-data is not an array (unlikely with Expo xml2js settings but possible)
        const metaArray = Array.isArray(metaDataList) ? metaDataList : [metaDataList];

        for (const metaData of metaArray) {
            const name = metaData.$['android:name'];
            if (name === targetName) {
                found = true;
                if (!metaData.$['tools:replace']) {
                    metaData.$['tools:replace'] = 'android:resource';
                } else if (!metaData.$['tools:replace'].includes('android:resource')) {
                    metaData.$['tools:replace'] += ',android:resource';
                }
            }
        }

        if (!found) {
            // Add it manually to ensure it exists with the override
            app['meta-data'].push({
                $: {
                    'android:name': targetName,
                    'android:resource': '@color/notification_icon_color',
                    'tools:replace': 'android:resource'
                }
            });
        }

        // Add foregroundServiceType for RNBackgroundActionsTask (Android 14+ FGS requirement)
        if (!app.service) {
            app.service = [];
        }

        let bgActionService = app.service.find(s => s.$ && s.$['android:name'] === 'com.asterinet.react.bgactions.RNBackgroundActionsTask');
        if (!bgActionService) {
            bgActionService = {
                $: {
                    'android:name': 'com.asterinet.react.bgactions.RNBackgroundActionsTask'
                }
            };
            app.service.push(bgActionService);
        }

        bgActionService.$['android:foregroundServiceType'] = 'location';
        // Ensure it merges properly with the native module's manifest
        if (!bgActionService.$['tools:node']) {
            bgActionService.$['tools:node'] = 'merge';
        }

        return config;
    });
};

module.exports = withAndroidManifestHelpers;
