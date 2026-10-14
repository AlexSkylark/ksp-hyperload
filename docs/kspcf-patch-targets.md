# KSPCommunityFixes 1.41.1: patch targets

Reference for avoiding Harmony conflicts. Built on 2026-10-14 from the KSPCF
source at tag `1.41.1` (MIT); the version matches KSP-bench. All targets were
seen in code (`[C]`) unless noted. Re-check this list whenever the bench's
KSPCF version changes.

Paths are relative to `KSPCommunityFixes/KSPCommunityFixes/` in the KSPCF repo.

## How KSPCF patches

- **`BasePatch` subclasses (127).** Patches are declared with
  `AddPatch(...)`/`PatchInfo` in `ApplyPatches()`. `BasePatch.ApplyHarmonyPatch()`
  registers them on the shared Harmony id `"KSPCommunityFixes"` at
  `Priority.Normal` (400); the only exception is `DockingPortLockedEvents`,
  which uses `Priority.First`.
  - When: `KSPCommunityFixes.MMPostLoadCallback()`, which runs after
    GameDatabase and ModuleManager patching and before `PartLoader`.
  - Gates, in order: `CanApplyPatch()`, the `Settings.cfg` key (skipped when
    `IgnoreConfig` is set), KSP version range.
- **Self-patching `[KSPAddon(Instantly)]` MonoBehaviours (4).** These always
  apply, and there is no `Settings.cfg` key for them:
  - `KSPCFFastLoader` uses three Harmony ids. Two of them are unpatched after
    loading finishes.
  - `ConfigNodePerf` uses the Harmony id `"ConfigNodePerf"`.
  - `ReflectionTypeLoadExceptionHandler` has its own Harmony id.
  - `NoIVA`.
- **Patch types:** `PatchType.Override` is a transpiler that replaces the
  whole method body. Other mods' prefixes and postfixes still wrap it. There
  are no `[HarmonyPatch]` attributes, no `PatchAll` and no MonoMod detours.
- **Non-Harmony changes:**
  - delegate swaps: `ProtoCrewMember.MaxSustainedG`, `Orbit.SolveSOI`;
  - `SceneManager.sceneLoaded`/`sceneUnloaded` handlers (`MemoryLeaks`).
- **Count:** about 400 Harmony patches in total. This is approximate, from
  grep hits minus `#if DEBUG`.

## Harmony 2.2.1 rules that matter for HyperLoad

From `Harmony/Internal/MethodPatcher.cs` (MIT):

- **Ordering.** Patches run by priority (highest first), then registration
  order. This applies to postfixes too.
- **Skipping prefixes.** Once a prefix sets `runOriginal = false`, later
  prefixes that "affect the original" are skipped.
  - A prefix affects the original if it returns `bool` or has a `ref`/`out`
    or reference-type parameter. `__instance`, `__originalMethod` and
    `__state` don't count.
  - A `static void Prefix(out long __state)` therefore always runs.
- **Postfixes** always run, unless something threw. In that case only
  finalizers run.
- **Coroutines.** Patching an `IEnumerator` method only times the creation of
  the enumerator. Patch `AccessTools.EnumeratorMoveNext(...)` instead.

## Targets relevant to loading and scene transitions

| Target | KSPCF patch | What KSPCF does | Effect on a timing hook |
|---|---|---|---|
| `GameDatabase.SetupMainLoaders` | FastLoader | Prefix starts `FastAssetLoader`, then **throws** to kill stock `LoadObjects` | Postfix never runs; use a finalizer |
| `GameDatabase.LoadObjects` (coroutine) | FastLoader (indirect) | Aborted; stock `DatabaseLoader`s for audio/texture/model never run | No stock per-asset hooks fire |
| `GameDatabase.LoadAssetBundleObjects` `MoveNext` | FastLoader | Prefix (skip), postfix and transpiler; holds it until FastLoader finishes | Many fake iterations |
| `GameDatabase.GetModel*`, `GetTexture*`, `ExistsModel`, `GetModelFile` | GameDatabasePerf (always on) | Override (dictionary lookups) | Prefix/postfix fine |
| `PartLoader.StartLoad` | FastLoader | Transpiler swaps the `CompileAll()` call for KSPCF's `PartLoader_CompileAll` | **Stock `CompileAll` never runs at startup** |
| `PartLoader.CompileParts`, `DragCubeSystem.SetupDragCubeCoroutine(Part)`, `RenderDragCubesCoroutine`, `RenderDragCubes` (`MoveNext`) | FastLoader | Transpilers make nested `StartCoroutine` a pass-through; stock bodies still run | Time synchronous inner methods (`ParsePart`, `CreatePartIcon`) |
| `PartLoader.CreatePartIcon`, `PartLoader.ApplyPartValue` | PartParsingPerf | Override | Fine |
| `DragCubeSystem.RenderProceduralDragCube` | DragCubeGeneration | Prefix returns false (replacement) | Postfix fine; prefix must be non-affecting |
| `DragCubeSystem.SetupDragCubeCoroutine` (both overloads) `MoveNext` | DragCubeGeneration | Transpiler | `MoveNext` hooks still work |
| `ExpansionsLoader.StartLoad` | ExpansionBundlePreload; FastLoader (timing prefix) | Override: the body only sets a flag; DLCs load in `LoadExpansionsV2` in parallel | Time with `GameEvents.OnExpansionSystemLoaded` |
| `ExpansionsLoader.InitializeExpansion` | OptionalMakingHistoryDLCFeatures | Prefix that skips MH when disabled | [I] Possibly unused under ExpansionBundlePreload |
| `PSystemManager.Awake` | FastLoader | Timing prefix | Fine |
| `PSystemSetup.Awake` | MapSOCorrectWrapping | Postfix (**off on bench**, disabled by Kopernicus) | Fine |
| `ConfigNode.Load(string,bool)`, `Parse`, `Save(string,string)`, `CleanupInput`, `CopyToRecursive`, both ctors, both `AddValue`, `Value.Sanitize`, `ValueList.Add` | ConfigNodePerf (always on) | Prefixes returning false (replacements) | Postfix fine; prefix must be non-affecting; **called from MM's worker thread** |
| `ConfigNode.ReadObject`, `WriteObject` | PersistentIConfigNode | Override | Fine |
| `ConfigNode.CreateConfigFromObject`, `LoadObjectFromConfig` | PersistentIConfigNode | Prefix + postfix | Fine |
| `Localizer.Format` ×3, `Localizer.TranslateBranch` | LocalizerPerf | Prefixes returning false | Very hot; per-call timing too expensive |
| `System.Reflection.Assembly.GetTypes()` | ReflectionTypeLoadExceptionHandler (always on) | Prefix returning false; swallows `ReflectionTypeLoadException` | Affects every later reflection call |
| `Part.FindModelTransform*`, `FindHeirarchyTransform*` | FasterPartFindTransform | Prefixes returning false | Hot during part compile |
| `BaseFieldList.Load`, `BaseField.Read`, `BaseField<KSPField>.GetValue/SetValue` | BaseFieldListUseFieldHost | Override | Runs during part compile |
| `HighLogic.LoadScene` | FlightSceneLoadKraken (**off**) | Postfix | Fine |
| `SceneTransitionMatrix.GetTransitionValue` | ForceSyncSceneSwitch | Prefix returning false: all switches synchronous | **Off on bench** (UniversalStorage2) |
| `GamePersistence.LoadGame(string,string,bool,bool)` | SceneLoadSpeedBoost | Transpiler: `LoadSFSFile` → cached version | Fine; record cache hits |
| `GamePersistence.SaveGame(Game,string,string,SaveMode)` | SceneLoadSpeedBoost | Transpiler: caches the saved node | Fine. Other overloads not patched |
| `Game..ctor(ConfigNode)` | RespawnDeadKerbals | Postfix | Fine |
| `Game.Updated()`, `ShipConstruct.SaveShip` | ConfigNodePerf | Prefix + postfix (flag) | Fine |
| `ShipConstruct.LoadShip(ConfigNode,uint,bool,out string)`, `ProtoPartSnapshot.ConfigurePart` | ModuleIndexingMismatch | Transpiler | Fine |
| `FlightDriver.Start` | FlightSceneLoadKraken (**off**) | Prefix | Fine |
| `FlightDriver.setStartupNewVessel` | PQSOnlyStartOnce (**off**) | Transpiler | — |
| `Part.Start` `MoveNext`, `FlightIntegrator.Update` | PartStartStability | Transpiler / prefix | Affects flight scene load |
| `PQS.StartSphere`, `PQS.ResetAndWait` | PQSCoroutineLeak, MinorPerfTweaks | Transpilers | Fine |
| `ProtoPartSnapshot.Load`, `Part.OnDestroy`, `Vessel.Unload` and about 20 more `OnDestroy`-style methods | MemoryLeaks | Postfixes/prefixes, plus scene-switch cleanup | Adds work on every scene switch |
| `AddonLoader.*`, `LoadingScreen.*`, `AssemblyLoader.*`, `Game.Load`, `ScenarioRunner.*`, `MainMenu.Start`, `LoadingBufferMask.*` | — | Not patched | Free to hook |

## Full list by patch class

The **Default** column is the shipped `Settings.cfg` value. KSP-bench
overrides are noted in bold. Patch types:
- Pre = prefix
- Pre/skip = prefix returning false
- Post = postfix
- Tr = transpiler
- Ovr = override
- NH = non-Harmony

### BugFixes

| Patch | Default | Targets | Type |
|---|---|---|---|
| AsteroidInfiniteMining | on | `ModuleSpaceObjectInfo.currentMassVal` setter | Pre |
| AsteroidSpawnerUniqueFlightId | on | `ScenarioDiscoverableObjects.SpawnAsteroid` | Pre |
| CometSpawnerUniqueFlightId | on | `ScenarioDiscoverableObjects.SpawnComet(CometOrbitType)` | Pre |
| AutoStrutDrift | on | `Part.SecureAutoStrut(Part,AttachNode,AttachNode,bool)` | Post |
| BlockMapViewPartClick | on | `Part.UpdateMouseOver` | Pre |
| ChutePhantomSymmetry | on | `ModuleParachute.OnStart`, `OnDestroy` | Post |
| CometMiningNotRemovingMass | on | `ModuleComet.GetModuleMass` | Pre |
| CorrectDragForFlags | on | `FlagDecalBackground.EnableCurrentFlagMesh` | Post |
| DebugConsoleDontStealInput | on | `DebugScreenConsole.OnEnable`, `SubmitCommand`, `OnMemoryLogUpdated` | Tr |
| DeltaVHideWhenDisabled | on | `StageGroup.Awake`, `StageManager.Awake` (Post); `StageGroup.ToggleInfoPanel(bool)` (Pre); `NavBallBurnVector.onGameSettingsApplied`, `LateUpdate` (Pre+Post) | mixed |
| DockingPortConserveMomentum | on | `ModuleDockingNode` `<SetupFSM>` closures | Tr |
| DockingPortRotationDriftAndFixes | on | `ModuleDockingNode.OnLoad` (Tr); `OnSave`, `OnStart`, `OnDestroy` (Post); `OnStartFinished`, `RotationJoint`/`VisualTargetAngle` getters, `OnPartUnpack`, `UpdatePAWUI`, `UpdateAlignmentRotation`, `ApplyCoordsUpdate`, `SetJointHighLowLimits`, `ModifyLocked`, `IsJointUnlocked` (Pre) | mixed |
| DoubleCurvePreserveTangents | on | `DoubleCurve.RecomputeTangents` | Tr |
| DragCubeLoadException | on | `DragCube.Load` | Tr |
| EditorAnimatedPartsShipModified | on | `Part.ModulesOnStartFinished` | Post |
| EnginePlateAirstreamShieldedTopPart | on | `ModuleDecouplerBase.SetAirstream` | Pre |
| EVAConstructionMass | on | `EVAConstructionModeEditor.PickupPart` | Tr |
| EVAConstructionUninitializedInventory | on | `EVAConstructionModeController.SearchForInventoryParts` | Ovr |
| EVAKerbalRecovery | on | `ProtoVessel.GetAllProtoPartsIncludingCargo` | Pre |
| ExtendedDeployableParts | on | `ModuleDeployablePart.startFSM`, `ModuleDeployableSolarPanel.OnStart` (Tr); `ModuleDeployablePart.FindAnimations` (Post) | mixed |
| FastAndFixedEnumExtensions | on | `EnumExtensions.Description`, `displayDescription` | Ovr |
| FIUpdateRadiation | on | `FlightIntegrator.UpdateRadiation` | Ovr |
| FixGetUnivseralTime | on | `Planetarium.GetUniversalTime` | Pre |
| FlightSceneLoadKraken | off | `HighLogic.LoadScene` (Post); `FlightDriver.Start` (Pre) | mixed |
| HarvesterECConsumption | on | `ModuleResourceHarvester.GetInfo` | Tr |
| InventoryPartMass | on | `ModuleInventoryPart.UpdateCapacityValues` (Pre); `EditorPartIcon.Create`, `InventoryPartListTooltip.CreateInfoWidgets` (Post) | mixed |
| KerbalInventoryPersistence | on | `ProtoCrewMember.kerbalModule` getter | Tr |
| KerbalTooltipMaxSustainedG | on | `ProtoCrewMember.MaxSustainedG` delegate | NH |
| LadderToggleableLight | on | `RetractableLadder.OnStart` | Tr |
| LostSoundAfterSceneSwitch | on | `FlightCamera.EnableCamera`, `DisableCamera(bool)` | Tr |
| MapSOCorrectWrapping | on, **off on bench** | `MapSO.ConstructBilinearCoords` (both overloads, Pre/skip); `PSystemSetup.Awake` (Post) | mixed |
| MapTargetBodyWithEncounter | on | `OrbitTargeter.TargetCastNodes` | Tr |
| ModuleActiveRadiatorNoParentException | on | `ModuleActiveRadiator.IsSibling` | Ovr |
| ModuleAnimateGenericCrewModSpawnIVA | on | `ModuleAnimateGeneric.CheckCrewState` | Tr |
| ModuleIndexingMismatch | on | `ProtoPartSnapshot.ConfigurePart`, `ShipConstruct.LoadShip(ConfigNode,uint,bool,out string)` | Tr |
| ModulePartVariantsNodePersistence | on | `ModulePartVariants.ApplyVariant` (Tr); `UpdatePartPosition` (Pre) | mixed |
| PackedPartsRotation | on | `Vessel.GoOnRails` | Post |
| PartBoundsIgnoreDisabledTransforms | on | `PartGeometryUtil.GetPartRendererBounds` | Pre |
| PartListTooltipIconSpin | on | `PartListTooltipController.CreateTooltip` | Post |
| PartStartStability | on | `Part.Start` `MoveNext` (Tr); `FlightIntegrator.Update` (Pre) | mixed |
| PartTooltipUpgradesApplyToSubstituteParts | off | `PartListTooltip.Setup` (Tr+Pre), `UpdateVariantText` (Tr), `GetUpgradedPrimaryInfo` (Pre) | mixed |
| PatchedConicEncounterFlickering | on | `Orbit.SolveSOI` delegate | NH |
| PAWGroupMemory | on | `UIPartActionGroup.Initialize` (Tr); `Collapse`, `Expand` (Post) | mixed |
| PAWItemsOrder | on | `UIPartActionWindow.AddGroup` (2 overloads) | Pre |
| PropellantFlowDescription | on | `Propellant.GetFlowModeDescription` | Pre+Post |
| ReactionWheelsPotentialTorque | on | `ModuleReactionWheel.GetPotentialTorque` | Pre |
| RefundingOnRecovery | on | `Funding.onVesselRecoveryProcessing` | Tr |
| ReRootPreserveSurfaceAttach | on | `Part.SetHierarchyRoot` | Tr |
| RescaledRoboticParts | on | `BaseServo.SetChildParentTransform` | Tr |
| RespawnDeadKerbals | on | `Game..ctor(ConfigNode)` | Post |
| RestoreMaxPhysicsDT | on | `TimeWarp.updateRate` | Post |
| RoboticsDrift | on | `BaseServo.OnStart`, `OnDestroy` (Post); `RecurseCoordUpdate`, `OnSave`, `ModifyLocked`, `OnPartPack` (Pre) | mixed |
| ROCValidationOOR | on, **off on bench** | `ROCManager.ValidateCBBiomeCombos` | Pre |
| ScatterDistribution | on, **off on bench** | `PQSLandControl.OnVertexBuildHeight` | Tr |
| StickySplashedFixer | on | `Vessel.updateSituation` (Pre); `Part.Die`, `Part.decouple` (Pre+Post) | mixed |
| StockAlarmCustomFormatterDate | on | `AppUIMemberDateTime.OnRefreshUI`, `InputEdited` | Pre |
| StockAlarmDescPreserveLineBreak | on | `AlarmTypeBase.OnSave` | Pre |
| StrategyDuration | off | `Strategy.LongestDuration`/`LeastDuration` getters (Pre/skip); `CanBeDeactivated`, `SendStateMessage` (Tr) | mixed |
| SymmetryReferenceOnDelete | on | `EditorLogic.wipeSymmetry` | Ovr |
| ThumbnailSpotlight | on | `CraftThumbnail.TakePartSnapshot` | Post |
| TimeWarpBodyCollision | on | `TimeWarp.ClampRateToOrbitTransitions` | Pre |
| TimeWarpOrbitShift | on | `TimeWarp.setRate` | Pre |
| UpgradeBugs | on | `PartModule..ctor`, `PartListTooltip.Setup`, `UpdateVariantText`, `Part.GetModuleCosts`, `EditorLogic.SpawnPart` (Post); `PartListTooltip.SetupUpgradeInfo`, `DisplayExtendedInfo`, `CreateExtendedInfo`, `PartModule.UpgradesAvailable`, `EditorLogic.OnPodSpawn`, `EditorLogic.SpawnPart`, `PartUpgradeHandler.Upgrade.GetUsedByStrings` (Pre); `PartModule.FindUpgrades` (Tr) | mixed |
| WheelInertiaLimit | on | `VehiclePhysics.Wheel.RecalculateConstants` | Post |
| ZeroCostTechNodes | on | `RDTech.Start` (Post); `RDTech.Load` (Tr) | mixed |

### QoL, Internal, Modding

| Patch | Default | Targets | Type |
|---|---|---|---|
| AltimeterHorizontalPosition | on | `MapView.enterMapView` (Pre), `exitMapView` (Post) | mixed |
| AutoSavedCraftNameAtLaunch | on | `VesselSpawnDialog.VesselDataItem..ctor(FileInfo,bool,bool)` | Post |
| AutostrutActions | on | `Part.Awake` (Post); `Part.ModulesOnStartFinished` (Pre) | mixed |
| BetterEditorUndoRedo | on | `EditorLogic.RestoreState`, `GizmoOffset.OnHandleMoveStart`, `GizmoRotate.OnHandleRotateStart`, `UIPartActionVariantSelector.SelectVariant` (Pre); `EditorLogic.SetupFSM` (Post); `onRotateGizmoUpdated`, `onOffsetGizmoUpdated`, `ModulePartVariants.onVariantChanged`, `Part.RemoveFromSymmetry`, `EditorActionGroups.ResetPart/AddActionToGroup/RemoveActionFromGroup` (Tr); runtime Tr on `on_partPicked`/`on_partAttached` lambdas | mixed |
| DisableManeuverTool | on | `ManeuverTool.OnAppAboutToStart` | Pre |
| DisableNewGameIntro | off | `ScenarioNewGameIntro.OnAwake` | Pre |
| FairingMouseOverPersistence | on | `ModuleProceduralFairing.OnSave`, `OnLoad` | Pre |
| NoIVA (MonoBehaviour) | in-game setting, off | `KerbalPortrait.Setup`, `KerbalPortraitGallery.UIControlsUpdate` (Post); `CameraManager.SetCameraIVA` (Pre/skip); rewrites INTERNAL/PROP configs | mixed |
| OptionalMakingHistoryDLCFeatures | on | `ExpansionsLoader.InitializeExpansion` | Pre/skip when MH disabled |
| PAWCollapsedInventories | on | `ModuleInventoryPart.OnStart`, `UpdateMassVolumeDisplay`, `UIPartActionInventory.Setup` (Post); `UIPartActionWindow.AddCrewInventory` (Tr+Post) | mixed |
| PAWStockGroups | on | `Part.Start`; `OnStart` of `ModuleDataTransmitter`, `ModuleCommand`, `ModuleReactionWheel`, `ModuleRCS`, `ModuleGimbal`, `ModuleControlSurface`, `ModuleGenerator` | Post |
| ResourceLockActions | on | `Part.Awake` | Post |
| ShowContractFinishDates | on | `MissionControl.UpdateInfoPanelContract` | Post |
| TargetParentBody | on | `OrbitTargeter.DropInvalidTargets` (Pre); `FlightGlobals.UpdateInformation` (Tr) | mixed |
| ToolbarShowHide | on | `ApplicationLauncher.SpawnSimpleLayout`, `OnDestroy`, `StartupSequence` (Post); `Show`, `Hide`, `ShouldItShow`, `ShouldItHide` ×2 (Pre) | mixed |
| TweakableWheelsAutostrut | on | `ModuleWheelBase.OnStart` | Pre+Tr |
| UIFloatEditNumericInput | on | `UIPartActionController.Awake` (Post); `GetFieldControl`, `GetControl` (Pre) | mixed |
| PatchSettings (Internal) | always | `GameplaySettingsScreen.DrawMiniSettings`, `ApplySettings` | Post |
| BaseFieldListUseFieldHost | on | `BaseField<KSPField>.GetValue/SetValue`, `BaseField.Read`, `BaseFieldList.Load` | Ovr |
| DepartmentHeadImage | on | `Administration.AddKerbalListItem` | Post |
| DockingPortLockedEvents | off, **on on bench** (KJR) | `ModuleDockingNode.ModifyLocked` | Pre (`Priority.First`) + Post |
| EventProfilerMarkers | off | `EventVoid.Fire`, `EventData<…>.Fire` (fixed list of instantiations) | Ovr |
| KSPFieldEnumDesc | off | `BaseField.GetStringValue` | Pre |
| ModUpgradePipeline | off | `ShipConstruct.SaveShip`, `Game.Save`, `SaveUpgradePipeline.Init/Run` (Post); `KSPUpgradePipeline.Process`, `SaveUpgradePipeline.SanityCheck/RunIteration`, `UpgradeScript.Test` (Pre) | mixed |
| OnSymmetryFieldChanged | off | `UIPartActionFieldItem.SetSymCounterpartValue` | Pre |
| PersistentIConfigNode | on | `ConfigNode.ReadObject`, `WriteObject` (Ovr); `CreateConfigFromObject`, `LoadObjectFromConfig` (Pre+Post) | mixed |
| ReflectionTypeLoadExceptionHandler (MonoBehaviour) | always | `System.Reflection.Assembly.GetTypes()` | Pre/skip |

### Performance

| Patch | Default | Targets | Type |
|---|---|---|---|
| ActiveRadiatorPerf | on | `ModuleActiveRadiator.OnAwake`, `Start` (Post); `FixedUpdate`, `CheckPartCaches`, `InternalCooling`, `CheckResources` (Ovr) | mixed |
| AsteroidAndCometDrillCache | on | `ModuleAsteroidDrill`/`ModuleCometDrill` `.IsSituationValid`, `.GetAttachedPotato` | Pre |
| CargoBayPerf | on | `ModuleCargoBay.onVesselModified`, `ColliderListCleanUp` | Ovr |
| CollisionEnhancerFastUpdate | on | `CollisionEnhancer.FixedUpdate` | Ovr |
| CollisionManagerFastUpdate | on | `CollisionManager.UpdatePartCollisionIgnores` | Pre |
| CommNetThrottling | on | `CommNet.CommNetNetwork.Update` | Ovr |
| ConfigNodePerf (MonoBehaviour) | always | see "Targets relevant to loading" | Pre/skip |
| ContractProgressEnumCache | on | `ProgressUtilities.GetAnyBodyProgress` | Tr |
| CraftBrowserOptimisations | on | `CraftBrowserDialog.setbottomButtons`, `Start`, `ReDisplay` (Post); `ShipConstruction.CheckCraftFileType`, `CraftBrowserDialog.BuildPlayerCraftList`, `CraftSearch.SearchRoutine` (Pre); `ShipConstruction.GetThumbnail` (Tr) | mixed |
| DisableHiddenPortraits | on | `KerbalPortrait.OnEnable` | Pre |
| DisableMapUpdateInFlight | on | `OrbitRendererBase.Start` (Post), `LateUpdate` (Pre) | mixed |
| DragCubeGeneration | on | `DragCubeSystem.RenderProceduralDragCube` (Pre/skip); `SetupDragCubeCoroutine` ×2 `MoveNext` (Tr); `ScreenPhysics.Start` (Pre) | mixed |
| ExpansionBundlePreload | on | `ExpansionsLoader.StartLoad` | Ovr |
| FasterEditorPartList | on | `EditorPartList.ClearAllItems`, `UpdatePartIcon`, `UpdatePartIcons` (Tr); `BasePartCategorizer.PartMatchesSearch` (Ovr) | mixed |
| FasterPartFindTransform | on | `Part.FindHeirarchyTransform(s)`, `FindModelTransform(s)` | Pre/skip |
| FastLoader (MonoBehaviour) | always | see "Targets relevant to loading" | mixed |
| FewerSaves | off | `ACSceneSpawner.onACDespawn`, `AdministrationSceneSpawner.onAdminDespawn`, `MCSceneSpawner.OnMCDespawn`, `RDSceneSpawner.onRDDespawn` (Pre); `SpaceTracking.OnVesselDeleteConfirm` (Tr) | mixed |
| FlightIntegratorPerf | on | `VesselPrecalculate.CalculatePhysicsStats`; `FlightIntegrator.Integrate`, `UpdateAerodynamics`, `UpdateMassStats`, `UpdateOcclusion*`, `PrecalcRadiation`, `GetSunArea`, `GetBodyArea` | Ovr |
| FloatingOriginPerf | on | `FloatingOrigin.setOffset` | Ovr |
| ForceSyncSceneSwitch | on, **off on bench** | `SceneTransitionMatrix.GetTransitionValue` | Pre/skip |
| GameDatabasePerf | always (via FastLoader) | `GameDatabase.GetModelPrefab(In)`, `GetModel(In)`, `GetModelFile(GameObject)`, `ExistsModel`, `GetTextureInfo(In)`, `GetTexture(In)` | Ovr |
| IMGUIOptimization | on | Unity `GUILayoutUtility.Begin` | Pre |
| LocalizerPerf | on | `Localizer.Format` ×3, `TranslateBranch` | Pre/skip |
| LowerMinPhysicsDTPerFrame | on | `SettingsScreen.Awake`, `ReflectedSettingsWindow.SetupReflectionValues` | Pre |
| MemoryLeaks | on | ~20 `OnDestroy`-style postfixes (`PartSet.HookEvents`, `ProtoPartSnapshot.Load/ConfigurePart`, `Part.OnDestroy`, `Vessel.Unload`, `EffectList.Initialize`, …), ~5 prefixes, `SceneManager.sceneLoaded/sceneUnloaded` handlers | mixed + NH |
| MinorPerfTweaks | on | `FlightGlobals.fetch` getter, `VolumeNormalizer.Update`, `MonoUtilities.RefreshContextWindows`, `RefreshPartContextWindow` (Ovr); `PQS.StartSphere` (Tr); ~30 `Part.isX()` overloads (Ovr) | mixed |
| ModuleColorChangerOptimization | on | `ModuleColorChanger.Start` (Post); `FixedUpdate`, `Update` (Ovr) | mixed |
| ModuleDockingNodeFindOtherNodesFaster | on | `ModuleDockingNode.FindNodeApproaches` (Pre); `OnLoad` (Post) | mixed |
| OnDemandPartBuoyancy | on | `PartBuoyancy.FixedUpdate` | Pre |
| OptimisedVectorLines | on | Vectrosity `VectorLine.Line3D`, `BehindCamera`, `IntersectAndDoSkip`, `Draw3D` | Tr |
| OptimizedModuleRaycasts | on | `ModuleEngines.EngineExhaustDamage` (Tr); `ModuleDeployableSolarPanel.CalculateTrackingLOS` (Pre); `ModuleSurfaceFX.Update` (Ovr) | mixed |
| PartParsingPerf | on | `PartLoader.CreatePartIcon`, `PartLoader.ApplyPartValue` | Ovr |
| PartSystemsFastUpdate | on | `TemperatureGaugeSystem.Update`, `Highlighter.UpdateRenderers`, `CModuleLinkedMesh.TrackAnchor` | Ovr |
| PQSCoroutineLeak | on | `PQS.StartSphere`, `PQS.ResetAndWait` | Tr |
| PQSOnlyStartOnce | off | `FlightDriver.setStartupNewVessel` | Tr |
| PQSUpdateNoMemoryAlloc | on | `PQS.BuildTangents` | Pre |
| ProgressTrackingSpeedBoost | on | `ProgressTracking.Update` (Pre); `KSPAchievements.CelestialBodySubtree..ctor` (Post) | mixed |
| ResourceConverterPerf | on | `ModuleResourceHarvester.PrepareRecipe`, `ResourceConverter.ProcessRecipe` (Tr); `BaseConverter.GetDeltaTime` (Ovr) | mixed |
| SceneLoadSpeedBoost | on | `GamePersistence.SaveGame(Game,string,string,SaveMode)`, `GamePersistence.LoadGame(string,string,bool,bool)` | Tr |

## Not checked / open

- For "Pre" rows not marked "/skip", nobody checked whether the prefix
  returns false. This matters only if HyperLoad hooks that target.
- The ~400 Harmony patch count is approximate.
- Patches are compiled with `#if DEBUG` excluded. A debug build of KSPCF
  would differ.
