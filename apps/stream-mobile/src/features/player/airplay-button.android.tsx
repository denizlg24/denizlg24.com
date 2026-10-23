import type { AirPlayButton as IOSAirPlayButton } from "./airplay-button";

/** AirPlay is Apple's; Android casts through the system, not the app. */
export const AirPlayButton: typeof IOSAirPlayButton = () => null;
