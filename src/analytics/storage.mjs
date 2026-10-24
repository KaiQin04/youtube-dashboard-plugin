import {AppError,randomString} from './security.mjs';
import {normalizeSnapshot,assertDate,dateSequence} from './contracts.mjs';
const COVERAGE_TEXT=Object.freeze({
 source:'YouTube Analytics API v2 + YouTube Data API v3',
 watermarkMeaning:'Latest channel day returned for the requested metrics, subject to provider revision; missing dates remain unknown.',
 contentFormat:'not_classified; Shorts, long-form and live are not inferred from duration',
 videoSubscriberAttribution:'Video-filtered subscriptions are attributed to video watch pages and need not sum to channel subscriptions.',
});
/** Explicit adapter coverage contract; reject malformed values and never retain unknown nested fields. */
export function normalizeCoverage(value) {
 if(value===undefined)return undefined;
 const fail=()=>{throw new AppError('INVALID_COVERAGE','Snapshot coverage is invalid.');};
 if(!value||typeof value!=='object'||Array.isArray(value))fail();
 const out={};
 for(const [field,expected] of Object.entries(COVERAGE_TEXT)){if(value[field]!==expected)fail();out[field]=expected;}
 if(!['top_by_views_in_requested_period','all_current_uploads'].includes(value.videoSelection))fail();out.videoSelection=value.videoSelection;
 for(const field of ['requestedStartDate','requestedEndDate','availableThrough']){assertDate(value[field],field);out[field]=value[field];}
 if(out.requestedStartDate>out.availableThrough||out.availableThrough>out.requestedEndDate||dateSequence(out.requestedStartDate,out.requestedEndDate).length>31)fail();
 for(const field of ['channelDaysReturned','channelDaysExpected','videoLimit','videoIdsReturned','videoMetadataAvailable','videoMetadataMissing']){if(!Number.isSafeInteger(value[field])||value[field]<0||value[field]>10000)fail();out[field]=value[field];}
 const allVideosCovered=out.videoSelection==='all_current_uploads'&&out.videoMetadataMissing===0;
 if(out.channelDaysExpected!==dateSequence(out.requestedStartDate,out.availableThrough).length||out.channelDaysReturned>out.channelDaysExpected||out.videoLimit<1||out.videoIdsReturned>out.videoLimit||out.videoMetadataAvailable+out.videoMetadataMissing!==out.videoIdsReturned||value.allVideosCovered!==allVideosCovered)fail();
 out.allVideosCovered=allVideosCovered;
 if(value.videoReportsRequested!==undefined){
  for(const field of ['videoReportsRequested','videosWithDailyRows','videosWithoutDailyRows']){if(!Number.isSafeInteger(value[field])||value[field]<0||value[field]>out.videoMetadataAvailable)fail();out[field]=value[field];}
  if(out.videoReportsRequested!==out.videoMetadataAvailable||out.videosWithDailyRows+out.videosWithoutDailyRows!==out.videoReportsRequested)fail();
 }
 return out;
}
