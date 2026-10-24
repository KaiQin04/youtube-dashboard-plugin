/** Fixed nonmonetary report contracts; no arbitrary upstream query editor. */
const viewing=['views','engagedViews','estimatedMinutesWatched'];
const details=[...viewing,'averageViewDuration','averageViewPercentage'];
export const REPORTS=[
 {id:'trafficSources',label:'流量來源',dimensions:['insightTrafficSourceType'],metrics:viewing},
 {id:'countries',label:'觀看國家',dimensions:['country'],metrics:details},
 {id:'devices',label:'觀看裝置',dimensions:['deviceType'],metrics:viewing},
 {id:'operatingSystems',label:'作業系統',dimensions:['operatingSystem'],metrics:viewing},
 {id:'deviceSystems',label:'裝置與作業系統',dimensions:['deviceType','operatingSystem'],metrics:viewing},
 {id:'playbackLocations',label:'播放位置',dimensions:['insightPlaybackLocationType'],metrics:viewing},
 {id:'subscriptionStatus',label:'觀眾訂閱狀態',dimensions:['subscribedStatus'],metrics:details},
 {id:'contentTypes',label:'內容類型',dimensions:['creatorContentType'],metrics:details},
 {id:'demographics',label:'觀眾年齡與性別',dimensions:['ageGroup','gender'],metrics:['viewerPercentage']},
 {id:'sharingServices',label:'分享平台',dimensions:['sharingService'],metrics:['shares']},
 {id:'engagement',label:'每日互動',dimensions:['day'],metrics:['likes','comments','dislikes','shares','videosAddedToPlaylists','videosRemovedFromPlaylists'],daily:true},
 {id:'cards',label:'資訊卡成效',dimensions:['day'],metrics:['cardImpressions','cardClicks','cardClickRate','cardTeaserImpressions','cardTeaserClicks','cardTeaserClickRate'],daily:true},
 {id:'searchTerms',label:'YouTube 搜尋詞',dimensions:['insightTrafficSourceDetail'],metrics:viewing,filter:'insightTrafficSourceType==YT_SEARCH',limit:25},
 {id:'externalSources',label:'外部流量明細',dimensions:['insightTrafficSourceDetail'],metrics:viewing,filter:'insightTrafficSourceType==EXT_URL',limit:25},
 {id:'relatedVideos',label:'推薦影片來源',dimensions:['insightTrafficSourceDetail'],metrics:viewing,filter:'insightTrafficSourceType==RELATED_VIDEO',limit:25},
 {id:'embeddedSites',label:'外嵌播放網站',dimensions:['insightPlaybackLocationDetail'],metrics:viewing,filter:'insightPlaybackLocationType==EMBEDDED',limit:25},
 {id:'retention',label:'逐段觀眾留存',dimensions:['elapsedVideoTimeRatio'],metrics:['audienceWatchRatio','relativeRetentionPerformance','startedWatching','stoppedWatching','totalSegmentImpressions'],video:true,limit:200},
 {id:'concurrentViewers',label:'直播同時觀看',dimensions:['livestreamPosition'],metrics:['averageConcurrentViewers','peakConcurrentViewers'],video:true,limit:1000},
];
export const REPORT_FIELDS=Object.fromEntries([
 ['views','觀看次數','次'],['engagedViews','參與觀看','次'],['estimatedMinutesWatched','觀看時間','分鐘','decimal'],
 ['averageViewDuration','平均觀看時間','秒','decimal'],['averageViewPercentage','平均觀看比例','%','decimal'],
 ['viewerPercentage','觀眾比例','%','percentage'],['likes','按讚','次'],['comments','留言','次'],['dislikes','不喜歡','次'],['shares','分享','次'],
 ['videosAddedToPlaylists','加入播放清單','次'],['videosRemovedFromPlaylists','移出播放清單','次'],
 ['cardImpressions','資訊卡曝光','次'],['cardClicks','資訊卡點擊','次'],['cardClickRate','資訊卡點閱率','%','ratio'],
 ['cardTeaserImpressions','資訊卡提示曝光','次'],['cardTeaserClicks','資訊卡提示點擊','次'],['cardTeaserClickRate','資訊卡提示點閱率','%','ratio'],
 ['audienceWatchRatio','觀看留存比例','%','rewatch'],['relativeRetentionPerformance','相對留存表現','%','ratio'],
 ['startedWatching','開始觀看此段','次'],['stoppedWatching','離開此段','次'],['totalSegmentImpressions','片段觀看','次'],
 ['averageConcurrentViewers','平均同時觀看','人','decimal'],['peakConcurrentViewers','最高同時觀看','人'],
].map(([id,label,unit,type='count'])=>[id,{id,label,unit,type}]));
export const reportById=id=>REPORTS.find(report=>report.id===id);
export const reportKey=({reportId,videoId})=>reportId+(videoId?':'+videoId:'');
export const REPORT_LIMITATIONS=[
 {id:'reach',label:'縮圖曝光與 CTR',status:'batch_required',note:'Reporting API 批次報表；需確認服務與報表工作，尚未匯入。'},
 {id:'revenue',label:'收益與廣告報表',status:'additional_scope_required',note:'現有授權不含收益權限。'},
 {id:'realtime',label:'Studio 即時 48 小時',status:'not_available',note:'目前公開報表無法直接重現。'},
 {id:'playlists',label:'播放清單專屬分析',status:'not_integrated',note:'需另外選擇播放清單並建立查詢；目前提供影片加入／移出清單的互動數。'},
];
