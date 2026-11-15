import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
// 07:15 UTC: the previous UTC day's VIIRS/MODIS NRT is essentially complete.
crons.daily("firms-nrt-pull", { hourUTC: 7, minuteUTC: 15 }, internal.pull.pullAll, {});
export default crons;
