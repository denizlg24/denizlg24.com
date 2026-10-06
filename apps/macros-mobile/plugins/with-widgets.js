// CommonJS on purpose: Expo compiles app.config.ts but requires local plugins
// as plain JavaScript.
const fs = require("node:fs");
const path = require("node:path");
const {
  withDangerousMod,
  withEntitlementsPlist,
  withInfoPlist,
  withXcodeProject,
} = require("expo/config-plugins");

// The WidgetKit extension: sources live in widgets/ios and are copied into
// the generated project, which never holds anything by hand.
//
// All widgets share a snapshot in the App Group. The group is installed on
// both targets and compiled into the extension on every iOS build.

// Not "MacrosWidgets": that is the Expo module's pod, and two Swift modules of one
// name in the same build products collide.
const TARGET = "MacrosWidgetExtension";
const SOURCE_DIR = path.join("widgets", "ios");
const DEPLOYMENT_TARGET = "17.0";

/** @param {Record<string, string | string[] | Record<string, string>>} entries */
function plist(entries) {
  /** @param {unknown} value @param {string} indent @returns {string} */
  const encode = (value, indent) => {
    if (Array.isArray(value)) {
      return `<array>\n${value.map((item) => `${indent}\t${encode(item, `${indent}\t`)}\n`).join("")}${indent}</array>`;
    }
    if (value && typeof value === "object") {
      const body = Object.entries(value)
        .map(
          ([key, item]) =>
            `${indent}\t<key>${key}</key>\n${indent}\t${encode(item, `${indent}\t`)}\n`,
        )
        .join("");
      return `<dict>\n${body}${indent}</dict>`;
    }
    return `<string>${value}</string>`;
  };
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
${encode(entries, "")}
</plist>
`;
}

/** @param {string} appGroup */
function extensionInfoPlist(appGroup) {
  return plist({
    CFBundleDevelopmentRegion: "$(DEVELOPMENT_LANGUAGE)",
    CFBundleDisplayName: "Macros",
    CFBundleExecutable: "$(EXECUTABLE_NAME)",
    CFBundleIdentifier: "$(PRODUCT_BUNDLE_IDENTIFIER)",
    CFBundleInfoDictionaryVersion: "6.0",
    CFBundleName: "$(PRODUCT_NAME)",
    CFBundlePackageType: "$(PRODUCT_BUNDLE_PACKAGE_TYPE)",
    CFBundleShortVersionString: "$(MARKETING_VERSION)",
    CFBundleVersion: "$(CURRENT_PROJECT_VERSION)",
    NSExtension: {
      NSExtensionPointIdentifier: "com.apple.widgetkit-extension",
    },
    MacrosAppGroup: appGroup,
  });
}

/** @param {string} appGroup */
function extensionEntitlements(appGroup) {
  return plist({ "com.apple.security.application-groups": [appGroup] });
}

function sourceFiles(projectRoot) {
  return fs
    .readdirSync(path.join(projectRoot, SOURCE_DIR))
    .filter((name) => name.endsWith(".swift"))
    .sort();
}

const FILE_TYPES = {
  ".swift": "sourcecode.swift",
  ".plist": "text.plist.xml",
  ".entitlements": "text.plist.entitlements",
};

/**
 * @param {import("xcode").XcodeProject} project
 * @param {{ bundleIdentifier: string, version: string, buildNumber: string, appGroup: string, sources: string[] }} options
 */
function addWidgetTarget(project, options) {
  const objects = project.hash.project.objects;
  const add = (section, uuid, object, comment) => {
    objects[section] ??= {};
    objects[section][uuid] = object;
    objects[section][`${uuid}_comment`] = comment;
  };
  // `addTarget` wires the dependency through these and skips it silently when
  // they are missing, which a single-target template project is.
  objects.PBXTargetDependency ??= {};
  objects.PBXContainerItemProxy ??= {};

  const target = project.addTarget(
    TARGET,
    "app_extension",
    TARGET,
    `${options.bundleIdentifier}.widgets`,
  );

  const files = [...options.sources, "Info.plist", `${TARGET}.entitlements`];
  const references = files.map((name) => {
    const uuid = project.generateUuid();
    add(
      "PBXFileReference",
      uuid,
      {
        isa: "PBXFileReference",
        lastKnownFileType: FILE_TYPES[path.extname(name)],
        path: `"${name}"`,
        sourceTree: '"<group>"',
      },
      name,
    );
    return { name, uuid };
  });

  const groupId = project.generateUuid();
  add(
    "PBXGroup",
    groupId,
    {
      isa: "PBXGroup",
      children: references.map(({ name, uuid }) => ({
        value: uuid,
        comment: name,
      })),
      path: TARGET,
      sourceTree: '"<group>"',
    },
    TARGET,
  );
  const mainGroupId = project.getFirstProject().firstProject.mainGroup;
  project
    .getPBXGroupByKey(mainGroupId)
    .children.push({ value: groupId, comment: TARGET });

  const sources = references
    .filter(({ name }) => name.endsWith(".swift"))
    .map(({ name, uuid }) => {
      const buildFile = project.generateUuid();
      add(
        "PBXBuildFile",
        buildFile,
        { isa: "PBXBuildFile", fileRef: uuid, fileRef_comment: name },
        `${name} in Sources`,
      );
      return { value: buildFile, comment: `${name} in Sources` };
    });

  const phases = [
    ["PBXSourcesBuildPhase", "Sources", sources],
    ["PBXFrameworksBuildPhase", "Frameworks", []],
    ["PBXResourcesBuildPhase", "Resources", []],
  ].map(([isa, comment, phaseFiles]) => {
    const uuid = project.generateUuid();
    add(
      isa,
      uuid,
      {
        isa,
        buildActionMask: 2147483647,
        files: phaseFiles,
        runOnlyForDeploymentPostprocessing: 0,
      },
      comment,
    );
    return { value: uuid, comment };
  });
  target.pbxNativeTarget.buildPhases.push(...phases);

  // The app's embed phase `addTarget` created is called "Copy Files"; Xcode's
  // own name says what it is for.
  const copyPhases = objects.PBXCopyFilesBuildPhase ?? {};
  for (const [key, phase] of Object.entries(copyPhases)) {
    if (typeof phase !== "object" || phase.name !== '"Copy Files"') continue;
    phase.name = '"Embed Foundation Extensions"';
    copyPhases[`${key}_comment`] = "Embed Foundation Extensions";
  }

  const configurationList =
    objects.XCConfigurationList[target.pbxNativeTarget.buildConfigurationList];
  for (const { value } of configurationList.buildConfigurations) {
    const configuration = objects.XCBuildConfiguration[value];
    const debug = configuration.name === "Debug";
    const conditions = [
      "$(inherited)",
      ...(debug ? ["DEBUG"] : []),
      "MACROS_APP_GROUP",
    ];
    configuration.buildSettings = {
      APPLICATION_EXTENSION_API_ONLY: "YES",
      ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME: '""',
      CLANG_ENABLE_MODULES: "YES",
      CODE_SIGN_ENTITLEMENTS: `${TARGET}/${TARGET}.entitlements`,
      CODE_SIGN_STYLE: "Automatic",
      CURRENT_PROJECT_VERSION: `"${options.buildNumber}"`,
      ...(debug ? { DEBUG_INFORMATION_FORMAT: "dwarf" } : {}),
      GENERATE_INFOPLIST_FILE: "NO",
      INFOPLIST_FILE: `${TARGET}/Info.plist`,
      IPHONEOS_DEPLOYMENT_TARGET: DEPLOYMENT_TARGET,
      LD_RUNPATH_SEARCH_PATHS:
        '"$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks"',
      MARKETING_VERSION: `"${options.version}"`,
      PRODUCT_BUNDLE_IDENTIFIER: `"${options.bundleIdentifier}.widgets"`,
      PRODUCT_NAME: '"$(TARGET_NAME)"',
      SKIP_INSTALL: "YES",
      SWIFT_ACTIVE_COMPILATION_CONDITIONS: `"${conditions.join(" ")}"`,
      SWIFT_EMIT_LOC_STRINGS: "YES",
      ...(debug ? { SWIFT_OPTIMIZATION_LEVEL: '"-Onone"' } : {}),
      SWIFT_VERSION: "5.0",
      TARGETED_DEVICE_FAMILY: '"1"',
    };
  }
}

/**
 * @type {import("expo/config-plugins").ConfigPlugin}
 */
const withWidgets = (config) => {
  const bundleIdentifier = config.ios?.bundleIdentifier;
  if (!bundleIdentifier) {
    throw new Error("with-widgets: ios.bundleIdentifier is required.");
  }
  const appGroup = `group.${bundleIdentifier}`;

  config = withXcodeProject(config, (mod) => {
    const project = mod.modResults;
    if (project.pbxTargetByName(TARGET)) return mod;
    addWidgetTarget(project, {
      bundleIdentifier,
      version: config.version ?? "1.0.0",
      buildNumber: config.ios?.buildNumber ?? "1",
      appGroup,
      sources: sourceFiles(mod.modRequest.projectRoot),
    });
    return mod;
  });

  config = withDangerousMod(config, [
    "ios",
    (mod) => {
      const { projectRoot, platformProjectRoot } = mod.modRequest;
      const destination = path.join(platformProjectRoot, TARGET);
      fs.rmSync(destination, { recursive: true, force: true });
      fs.mkdirSync(destination, { recursive: true });
      for (const name of sourceFiles(projectRoot)) {
        fs.copyFileSync(
          path.join(projectRoot, SOURCE_DIR, name),
          path.join(destination, name),
        );
      }
      fs.writeFileSync(
        path.join(destination, "Info.plist"),
        extensionInfoPlist(appGroup),
      );
      fs.writeFileSync(
        path.join(destination, `${TARGET}.entitlements`),
        extensionEntitlements(appGroup),
      );
      return mod;
    },
  ]);

  config = withEntitlementsPlist(config, (mod) => {
    mod.modResults["com.apple.security.application-groups"] = [appGroup];
    return mod;
  });
  return withInfoPlist(config, (mod) => {
    mod.modResults.MacrosAppGroup = appGroup;
    return mod;
  });
};

module.exports = withWidgets;
module.exports.extensionInfoPlist = extensionInfoPlist;
