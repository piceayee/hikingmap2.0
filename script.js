// 📌 全域範圍變數
let map;
let markers = []; // 儲存所有地圖上的標記 (JSON 景點)
let leafletTrailMarkers = {}; // 儲存 Leaflet 登山照片標記實例
let trailMarkersData = []; // 儲存所有上傳照片的數據，用於匯出/匯入
let gpxLayer = null; // 用來存儲 GPX 軌跡圖層
let gpxRawPoints = []; // 🚩 修正：儲存所有經過計算和過濾的 GPX 點位 (Q2 核心)
let currentGpxMode = 'proportional'; // 🚩 修正：當前 GPX 標記模式 (proportional 或 hourly)

// GPX 濾波器參數 (保持不變)
const MAX_HUMAN_SPEED_KMH = 20; 
const MAX_TIME_GAP_HOURS = 0.3;
const MARKER_DENSITY = 20; // 比例點位密度

// 📌 JSON 檔案 URL 列表 (官方景點數據)
const jsonUrls = [
];


// ----------------------------------------------------------------------
// ✅ 核心工具函式
// ----------------------------------------------------------------------

function convertDMSToDD(dms, direction) {
    if (!dms || dms.length < 3) return null;
    let dd = dms[0] + (dms[1] / 60) + (dms[2] / 3600);
    if (direction === 'S' || direction === 'W') {
        dd = dd * -1;
    }
    return isNaN(dd) ? null : dd;
}

function haversineDistance(lat1, lon1, lat2, lon2) {
    // ... (Haversine 2D 距離計算保持不變) ...
    const R = 6371;
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a = 
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // Kilometers
}

// 🚩 新增：3D 距離計算 (Q2 核心：考量垂直變化)
function haversineDistance3D(lat1, lon1, ele1, lat2, lon2, ele2) {
    const dist2D = haversineDistance(lat1, lon1, lat2, lon2); // 水平距離 (公里)
    // 垂直距離 (公尺轉公里)
    const dEleKm = (ele2 - ele1) / 1000; 
    // 畢氏定理：c^2 = a^2 + b^2
    return Math.sqrt(dist2D * dist2D + dEleKm * dEleKm); 
}


function formatMinutesToHMS(totalMinutes) {
    if (totalMinutes === null || totalMinutes < 0) return "N/A";
    const totalSeconds = Math.round(totalMinutes * 60);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const pad = (num) => num.toString().padStart(2, '0');
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

const parseExifDate = (dateString) => {
    if (!dateString) return null;
    const standardFormat = dateString.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1/$2/$3');
    const dateObj = new Date(standardFormat);
    if (isNaN(dateObj.getTime())) return null;
    return dateObj;
};

// ... (getCategoryClass 和 updatePopupStyle 保持不變) ...
function getCategoryClass(category) {
    switch (category) {
        case "花磚＆裝飾": return "tag-red";
        case "洋樓＆房舍": return "tag-orange";
        case "風獅爺": return "tag-yellow";
        case "軍事": return "tag-green";
        case "其他": return "tag-blue";
        case "登山紀錄": return "tag-purple"; 
        default: return "tag-purple";
    }
}

window.updatePopupStyle = function(img) {
    const popup = img.closest('.leaflet-popup');
    if (!popup) return;
    const isPortrait = img.naturalHeight > img.naturalWidth;
    const portraitWidth = '220px';
    const landscapeWidth = '300px';
    
    img.style.width = isPortrait ? portraitWidth : landscapeWidth;
    img.style.height = 'auto';

    const popupInstance = popup.parentNode._leaflet_popup;
    if (popupInstance) {
        setTimeout(() => popupInstance.update(), 50); 
    }
};

// ----------------------------------------------------------------------
// ✅ 地圖載入與點位處理 
// ----------------------------------------------------------------------
// ... (loadAllMarkersFromGitHub 和 addMarkerToMap 保持不變) ...

async function loadAllMarkersFromGitHub() {
    console.log("📥 開始並行載入所有 JSON 檔案 (靜態景點)...");
    try {
        const fetchPromises = jsonUrls.map(url => fetch(url).then(response => {
            if (!response.ok) throw new Error(`❌ 無法獲取 JSON: ${url}`);
            return response.json();
        }));
        const allData = await Promise.all(fetchPromises);
        console.log("✅ 所有靜態景點 JSON 檔案載入完成！");
        allData.forEach(data => {
            if (!Array.isArray(data)) {
                console.error("❌ JSON 格式錯誤，應該是陣列", data);
                return;
            }
            data.forEach(markerData => addMarkerToMap(markerData)); 
        });
    } catch (error) {
        console.error("❌ 載入靜態景點 JSON 失敗：", error);
    }
}

function addMarkerToMap(markerData) {
    
    if (typeof markerData.latitude !== 'number' || typeof markerData.longitude !== 'number' || isNaN(markerData.latitude) || isNaN(markerData.longitude)) {
        console.error("❌ 無法新增標記：座標無效或缺失。", markerData);
        return; 
    }
    
    let isTrailMarker = markerData.isTrailMarker || false; 

    let markerColor = "blue";
    if (!isTrailMarker && markerData.categories) { 
        if (markerData.categories.includes("花磚＆裝飾")) {
            markerColor = "red";
        } else if (markerData.categories.includes("洋樓＆房舍")) {
            markerColor = "black";
        } else if (markerData.categories.includes("風獅爺")) {
            markerColor = "yellow";
        } else if (markerData.categories.includes("軍事")) {
            markerColor = "green";
        } else if (markerData.categories.includes("其他")) {
            markerColor = "blue";
        }
    }
    
    // 建立 Popup 內容
    let displayDate = isTrailMarker 
        ? (markerData.time || "未知日期") 
        : (markerData.date || "未知日期");

    // 導航連結修正為標準 Google Maps 搜尋格式
    const gpsLink = `https://www.google.com/maps/search/?api=1&query=$$${markerData.latitude},${markerData.longitude}`;

    let popupContent = `
        <div class="popup-content">
            <strong>${markerData.name}</strong><br>
            <img src="${markerData.image}" class="popup-image" onload="window.updatePopupStyle(this);"><br>
            📅 拍攝日期: ${displayDate}<br>
            <a href="${gpsLink}" target="_blank" class="gps-link">
                GPS: ${markerData.latitude.toFixed(5)}, ${markerData.longitude.toFixed(5)}
            </a>
        </div>
    `;
    
    // 建立 Icon
    let markerIcon;
    if (isTrailMarker) {
        // 登山紀錄使用帶有編號的紫色圓形 Icon
        markerIcon = L.divIcon({
            className: 'trail-marker-container',
            html: `<div class="trail-marker-icon"><span>${markerData.order}</span></div>`,
            iconSize: [30, 42],
            iconAnchor: [15, 42],
            popupAnchor: [0, -38]
        });
    } else {
        // 靜態景點使用彩色圖釘 Icon
        markerIcon = L.icon({
            iconUrl: `https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-${markerColor}.png`,
            iconSize: [25, 41],
            iconAnchor: [12, 41],
            popupAnchor: [1, -34]
        });
    }

    // 建立 Marker
    let marker = L.marker([markerData.latitude, markerData.longitude], {
        icon: markerIcon, 
        categories: markerData.categories || []
    }).bindPopup(popupContent).on("click", function() {
        let currentZoom = map.getZoom();
        let targetZoom = 17;
        let latOffset = (currentZoom === 17) ? 0.003 : 0.0015;
        if (currentZoom < targetZoom) {
            map.flyTo([markerData.latitude + 0.003, markerData.longitude], targetZoom, { duration: 0.8 });
        } else {
            map.panTo([markerData.latitude + latOffset, markerData.longitude]);
        }
    });

    marker.addTo(map);

    marker.name = markerData.name;
    marker.date = displayDate;
    marker.isTrailMarker = isTrailMarker;
    marker.order = markerData.order; 
    marker.id = markerData.id || `static-${markerData.name}`; // 確保靜態點也有 ID
    marker.categories = markerData.categories || []; 
    
    if (isTrailMarker) {
        leafletTrailMarkers[marker.id] = marker;
    } else {
         markers.push(marker);
    }

    // 列表項目建立邏輯
    let tagHtml = markerData.categories && markerData.categories.length > 0
        ? markerData.categories.map(cat => `<span class="photo-tag ${getCategoryClass(cat)}">${cat}</span>`).join(" ")
        : `<span class="photo-tag no-category">未分類</span>`;

    let listItem = document.createElement("div");
    listItem.className = "photo-item";
    listItem.setAttribute("data-id", marker.id);
    listItem.innerHTML = `
        <img src="${markerData.image}" class="thumbnail">
        <div class="photo-info">
            <span class="photo-name">${markerData.name}</span>
            <div class="category-tags">${tagHtml}</div>
            <button class="go-to-marker">查看</button>
        </div>
    `;

    listItem.querySelector(".go-to-marker").addEventListener("click", function() {
        const targetMarker = isTrailMarker ? leafletTrailMarkers[marker.id] : marker;
        if(targetMarker) {
            map.flyTo([markerData.latitude, markerData.longitude], 17, { duration: 0.8 }); 
            targetMarker.openPopup(); 
        }
    });
    
    listItem.querySelector(".thumbnail").addEventListener("click", function() {
        const targetMarker = isTrailMarker ? leafletTrailMarkers[marker.id] : marker;
        if(targetMarker) {
            map.flyTo([markerData.latitude, markerData.longitude], 17, { duration: 0.8 });
            targetMarker.openPopup();
        }
    });

    let photoList = document.getElementById("photoList");
    if (isTrailMarker) {
        // 登山紀錄（紫色）項目放在列表最前面
        photoList.prepend(listItem);
    } else {
        // 靜態景點項目放在列表後面
        photoList.appendChild(listItem);
    }
    
    return marker;
}


// ----------------------------------------------------------------------
// ✅ GPX 軌跡處理 (數據解析、模式切換、增強匯出)
// ----------------------------------------------------------------------

function handleGpxUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    event.target.value = "";

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            gpxRawPoints = processGpxFile(e.target.result); // 提取並儲存所有豐富數據
            
            if (gpxRawPoints.length === 0) {
                alert("GPX 檔案中未找到有效的軌跡點或時間/海拔資訊。");
                return;
            }
            
            // 成功後，根據當前模式繪製
            toggleGpxView(currentGpxMode); 
            
            document.getElementById("exportGpxDataBtn").disabled = false;
            document.getElementById("exportConsolidatedDataBtn").disabled = false;
            document.getElementById("gpxMarkerModeSelect").disabled = false;
            
        } catch (error) {
            alert("❌ GPX 檔案解析失敗，請確認格式是否正確。");
            console.error("GPX 解析錯誤:", error);
            // 失敗後禁用按鈕
            document.getElementById("exportGpxDataBtn").disabled = true;
            document.getElementById("exportConsolidatedDataBtn").disabled = true;
            document.getElementById("gpxMarkerModeSelect").disabled = true;
        }
    };
    reader.readAsText(file);
}

// 🚩 修正：解析 GPX 內容並豐富數據 (不進行繪製)
function processGpxFile(gpxText) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(gpxText, "text/xml");
    const rawPoints = []; 
    const points = xmlDoc.querySelectorAll('trkpt, rtept, wpt');
    
    points.forEach(pt => {
        const lat = parseFloat(pt.getAttribute('lat'));
        const lon = parseFloat(pt.getAttribute('lon'));
        const timeElement = pt.querySelector('time');
        const eleElement = pt.querySelector('ele'); // 提取海拔

        let timeMs = null;
        let timeString = null;
        if (timeElement) {
            timeString = timeElement.textContent;
            timeMs = new Date(timeString).getTime();
        }

        const ele = eleElement ? parseFloat(eleElement.textContent) : undefined;

        if (!isNaN(lat) && !isNaN(lon) && timeMs) {
            rawPoints.push({ lat, lon, timeMs, timeString, ele }); 
        }
    });
    
    if (rawPoints.length === 0) return [];

    // 數據豐富化 (計算距離、時間差、海拔變化)
    const enrichedPoints = [];
    let accumulatedDistance2D = 0;
    let accumulatedDistance3D = 0;
    let startTimeMs = rawPoints[0].timeMs;
    let previousPoint = null;

    rawPoints.forEach((p1, i) => {
        let timeElapsedMinutes = 0;
        let distance2DSinceLastKm = 0;
        let distance3DSinceLastKm = 0;
        let elevationChange = 0;

        if (previousPoint) {
            timeElapsedMinutes = (p1.timeMs - previousPoint.timeMs) / (1000 * 60);
            
            // 2D 水平距離
            distance2DSinceLastKm = haversineDistance(previousPoint.lat, previousPoint.lon, p1.lat, p1.lon);
            accumulatedDistance2D += distance2DSinceLastKm;

            // 3D 行走距離 (Q2 核心)
            if (p1.ele !== undefined && previousPoint.ele !== undefined) {
                distance3DSinceLastKm = haversineDistance3D(previousPoint.lat, previousPoint.lon, previousPoint.ele, p1.lat, p1.lon, p1.ele);
                accumulatedDistance3D += distance3DSinceLastKm;
                elevationChange = p1.ele - previousPoint.ele;
            } else {
                 distance3DSinceLastKm = distance2DSinceLastKm; // 無海拔數據時使用 2D 距離
                 accumulatedDistance3D += distance3DSinceLastKm;
            }
        }

        const totalTimeMinutes = (p1.timeMs - startTimeMs) / (1000 * 60);
        
        enrichedPoints.push({
            // 基礎數據
            lat: p1.lat, 
            lon: p1.lon, 
            timeMs: p1.timeMs,
            timeString: p1.timeString,
            elevation: p1.ele, // 海拔高度
            // 增強數據
            timeElapsed: timeElapsedMinutes,
            distance2DSinceLast: distance2DSinceLastKm,
            distance3DSinceLast: distance3DSinceLastKm,
            totalTime: totalTimeMinutes,
            totalDistance2D: accumulatedDistance2D,
            totalDistance3D: accumulatedDistance3D,
            elevationChange: elevationChange // 垂直變化 (公尺)
        });

        previousPoint = p1;
    });

    return enrichedPoints;
}

// 🚩 新增：根據比例選擇標記點 (Q1 模式一)
function getProportionalMarkers(enrichedPoints) {
    const markers = [];
    if (enrichedPoints.length === 0) return markers;

    // 起點
    markers.push({ ...enrichedPoints[0], markerType: 'Start' });

    for (let i = MARKER_DENSITY; i < enrichedPoints.length - 1; i += MARKER_DENSITY) {
        markers.push({ ...enrichedPoints[i], markerType: 'Proportional' });
    }

    // 終點 (避免重複標記)
    const lastPoint = enrichedPoints[enrichedPoints.length - 1];
    if (markers.length === 0 || markers[markers.length - 1].timeMs !== lastPoint.timeMs) {
         markers.push({ ...lastPoint, markerType: 'End' });
    }
    return markers;
}

// 🚩 新增：根據整點選擇標記點 (Q1 模式二)
function getHourlyMarkers(enrichedPoints) {
    const markers = [];
    if (enrichedPoints.length === 0) return markers;

    const startTimeMs = enrichedPoints[0].timeMs;
    const endTimeMs = enrichedPoints[enrichedPoints.length - 1].timeMs;
    
    const startHourDate = new Date(startTimeMs);
    startHourDate.setUTCMinutes(0, 0, 0); 
    startHourDate.setUTCHours(startHourDate.getUTCHours() + 1);
    let nextHourMs = startHourDate.getTime();
    
    // 起點
    markers.push({ ...enrichedPoints[0], markerType: 'Start' });

    let lastCheckedIndex = 0;
    while (nextHourMs < endTimeMs) {
        let closestPoint = null;
        let minTimeDiff = Infinity;
        
        for (let i = lastCheckedIndex; i < enrichedPoints.length; i++) {
            const currentPoint = enrichedPoints[i];
            
            if (currentPoint.timeMs > nextHourMs + (30 * 60 * 1000)) { 
                lastCheckedIndex = i;
                break;
            }
            
            const timeDiff = Math.abs(currentPoint.timeMs - nextHourMs);

            if (timeDiff <= (30 * 60 * 1000) && timeDiff < minTimeDiff) {
                minTimeDiff = timeDiff;
                closestPoint = currentPoint;
            }
        }
        
        if (closestPoint && !markers.some(m => m.timeMs === closestPoint.timeMs)) {
             markers.push({ ...closestPoint, markerType: 'Hourly' });
        }
        
        nextHourMs += 1000 * 60 * 60; 
        if (nextHourMs > endTimeMs + (1000 * 60 * 60 * 2)) break; 
    }

    // 終點
    const lastPoint = enrichedPoints[enrichedPoints.length - 1];
    if (!markers.some(m => m.timeMs === lastPoint.timeMs)) {
        markers.push({ ...lastPoint, markerType: 'End' });
    }
    
    return markers;
}

// 🚩 新增：核心繪製函數 (根據模式繪製)
function toggleGpxView(mode) {
    if (gpxRawPoints.length === 0) return;
    currentGpxMode = mode;

    // 清空舊圖層
    if (gpxLayer) {
        map.removeLayer(gpxLayer); 
    }
    gpxLayer = L.layerGroup();
    
    // 1. 軌跡線段過濾和繪製
    const filteredSegments = [];
    let currentSegment = [];
    let previousPoint = null; 

    gpxRawPoints.forEach((p1, i) => {
        if (i === 0) {
            currentSegment.push([p1.lat, p1.lon]);
            previousPoint = p1;
            return;
        }

        const distanceKm = p1.distance2DSinceLast;
        const timeDiffHours = p1.timeElapsed / 60;

        let isValidConnection = true;

        if (timeDiffHours > MAX_TIME_GAP_HOURS) { 
            isValidConnection = false;
        } else if (timeDiffHours > 0) {
            const speedKmh = distanceKm / timeDiffHours;
            if (speedKmh > MAX_HUMAN_SPEED_KMH) {
                isValidConnection = false;
            }
        } else if (distanceKm > 0.5) { 
            isValidConnection = false;
        }
        
        if (isValidConnection) {
            currentSegment.push([p1.lat, p1.lon]);
        } else {
            if (currentSegment.length > 1) {
                filteredSegments.push(currentSegment);
            }
            currentSegment = [[p1.lat, p1.lon]]; 
        }
        previousPoint = p1;
    });

    if (currentSegment.length > 1) {
        filteredSegments.push(currentSegment);
    }

    filteredSegments.forEach(segment => {
        L.polyline(segment, {
            color: '#8A2BE2', // 紫色軌跡線
            weight: 4,
            opacity: 0.8
        }).addTo(gpxLayer);
    });

    // 2. 標記點位繪製
    const selectedMarkers = mode === 'hourly' 
        ? getHourlyMarkers(gpxRawPoints) 
        : getProportionalMarkers(gpxRawPoints);
        
    selectedMarkers.forEach(pt => {
        const dateObj = pt.timeMs ? new Date(pt.timeMs) : null;
        const timeStr = dateObj ? dateObj.toLocaleString() : '時間未知'; 
        const elevationStr = pt.elevation !== undefined ? `海拔: ${pt.elevation.toFixed(1)}m` : '';

        L.circleMarker([pt.lat, pt.lon], {
            radius: 6, 
            color: '#FF0000', // 紅色標示
            fillColor: '#FF0000',
            fillOpacity: 1,
            weight: 2
        }).bindPopup(`
            <strong>GPX 標記點 (${pt.markerType})</strong><br>
            時間: ${timeStr}<br>
            ${elevationStr}<br>
            GPS: ${pt.lat.toFixed(5)}, ${pt.lon.toFixed(5)}
        `).addTo(gpxLayer);
    });
    
    gpxLayer.addTo(map);

    // 定位地圖視角
    const allPoints = filteredSegments.flat();
    if (allPoints.length > 0) {
        map.fitBounds(L.latLngBounds(allPoints), { padding: [50, 50] });
    }
}

// 🚩 修正：匯出 GPX 詳細數據 (Q2 實現)
function exportGpxData() {
    if (gpxRawPoints.length === 0) {
        alert("沒有 GPX 數據可供匯出！");
        return;
    }

    let csvContent = "時間,緯度,經度,海拔(m),與前一點時間差(時:分:秒),海拔變化(m),水平距離差(km),行走距離差(km),累計時間(時:分:秒),累計水平距離(km),累計行走距離(km)\n";
    
    gpxRawPoints.forEach(item => {
        const timeElapsedHMS = formatMinutesToHMS(item.timeElapsed);
        const totalTimeHMS = formatMinutesToHMS(item.totalTime);
        const time = item.timeString ? new Date(item.timeString).toLocaleString().replace(/,/g, " ") : "未知時間";
        const eleStr = item.elevation !== undefined ? item.elevation.toFixed(2) : "N/A";
        const eleChangeStr = item.elevationChange !== undefined ? item.elevationChange.toFixed(2) : "N/A";
        
        csvContent += `"${time}",${item.lat.toFixed(6)},${item.lon.toFixed(6)},${eleStr},${timeElapsedHMS},${eleChangeStr},${item.distance2DSinceLast.toFixed(4)},${item.distance3DSinceLast.toFixed(4)},${totalTimeHMS},${item.totalDistance2D.toFixed(3)},${item.totalDistance3D.toFixed(3)}\n`;
    });

    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    
    if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", `GPX_詳細紀錄_${new Date().toISOString().slice(0, 10)}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
}

// 🚩 新增：整合匯出所有數據 (Q3 實現)
function exportConsolidatedData() {
    if (gpxRawPoints.length === 0 && trailMarkersData.length === 0) {
        alert("沒有任何 GPX 或照片數據可供匯出！");
        return;
    }

    // 1. 處理 GPX 數據
    const gpxData = gpxRawPoints.map(item => ({
        type: 'GPX',
        timeMs: item.timeMs,
        time: new Date(item.timeString).toLocaleString().replace(/,/g, " "),
        lat: item.lat,
        lon: item.lon,
        elevation: item.elevation !== undefined ? item.elevation.toFixed(2) : "N/A",
        timeElapsed: formatMinutesToHMS(item.timeElapsed),
        distance3D: item.distance3DSinceLast.toFixed(4),
        elevationChange: item.elevationChange !== undefined ? item.elevationChange.toFixed(2) : "N/A",
        name: 'N/A',
        totalDistance3D: item.totalDistance3D.toFixed(3)
    }));

    // 2. 處理照片數據
    const photoData = trailMarkersData.map(item => ({
        type: 'PHOTO',
        timeMs: new Date(item.time).getTime(),
        time: item.time.replace(/,/g, " "),
        lat: item.lat,
        lon: item.lon,
        // 照片沒有海拔數據，留空
        elevation: 'N/A', 
        timeElapsed: formatMinutesToHMS(item.timeElapsed),
        distance3D: item.distanceSinceLast.toFixed(4), 
        elevationChange: 'N/A',
        name: `照片 #${item.order}`,
        totalDistance3D: item.totalDistance.toFixed(3)
    }));

    // 3. 合併並按時間排序
    const allData = [...gpxData, ...photoData].sort((a, b) => a.timeMs - b.timeMs);

    let csvContent = "類型,時間,緯度,經度,海拔(m),與前點時間差(時:分:秒),海拔變化(m),行走距離差(km),累計行走距離(km),名稱/備註\n";
    
    allData.forEach(item => {
        csvContent += `${item.type},"${item.time}",${item.lat.toFixed(6)},${item.lon.toFixed(6)},${item.elevation},${item.timeElapsed},${item.elevationChange},${item.distance3D},${item.totalDistance3D},"${item.name}"\n`;
    });

    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    
    if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", `整合紀錄_${new Date().toISOString().slice(0, 10)}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
}


// ... (HEIC/DNG 處理、照片上傳、JSON 匯出/匯入、清除數據等函式保持不變) ...

// 處理單一檔案 (保留 DNG/HEIC 處理邏輯)
async function processFile(file) {
    const fileNameLower = file.name.toLowerCase();
    
    if (fileNameLower.endsWith('.heic') || fileNameLower.endsWith('.heif') || file.type.includes('heic') || file.type.includes('heif')) {
        // ... (HEIC 轉換邏輯) ...
        console.log(`ℹ️ 正在轉換 HEIC 檔案: ${file.name}`);
        try {
            if (typeof heic2any !== 'function') {
                alert(`HEIC 轉換失敗：heic2any 函式庫未載入。檔案 ${file.name} 將被跳過。`);
                return null;
            }
            
            const jpegBlob = await heic2any({
                blob: file,
                toType: "image/jpeg",
                quality: 0.8
            });
            
            return { originalFile: file, displayBlob: jpegBlob, isHeic: true, isRaw: false };
        } catch (error) {
            console.error(`❌ HEIC 轉換失敗: ${file.name}`, error);
            alert(`HEIC 轉換失敗: ${file.name}。錯誤代碼：${error.code}。`);
            return null; 
        }
    }
    
    if (fileNameLower.endsWith('.dng') || fileNameLower.endsWith('.raw')) {
        console.warn(`⚠️ 檔案 ${file.name} 是 RAW (DNG) 格式。將嘗試提取 GPS 資訊，但圖片可能因瀏覽器不支援而無法正常顯示。`);
        return { originalFile: file, displayBlob: file, isHeic: false, isRaw: true };
    }

    return { originalFile: file, displayBlob: file, isHeic: false, isRaw: false };
}


async function handlePhotoUpload(event) {
    const files = Array.from(event.target.files);
    if (files.length === 0) return;

    const processedFiles = await Promise.all(files.map(processFile));

    const promises = processedFiles.filter(p => p !== null).map(p => new Promise(resolve => {
        EXIF.getData(p.originalFile, function() {
            let date = EXIF.getTag(this, 'DateTimeOriginal'); 
            if (!date) {
                date = EXIF.getTag(this, 'DateTime');
            }

            const gpsLat = EXIF.getTag(this, 'GPSLatitude');
            const gpsLatRef = EXIF.getTag(this, 'GPSLatitudeRef');
            const gpsLon = EXIF.getTag(this, 'GPSLongitude');
            const gpsLonRef = EXIF.getTag(this, 'GPSLongitudeRef');

            let data = {
                file: p.originalFile, 
                displayBlob: p.displayBlob, 
                date, 
                gpsLat, 
                gpsLatRef, 
                gpsLon, 
                gpsLonRef, 
                name: p.originalFile.name,
                isRaw: p.isRaw 
            };
            resolve(data);
        });
    }));

    let newRawData = await Promise.all(promises);
    
    await processAndRedrawAllTrailRecords(newRawData, trailMarkersData); 
    
    event.target.value = "";
}

async function processAndRedrawAllTrailRecords(newRawData, existingTrailRecords, gpxTrack = null) {
    // ... (此函式中段的邏輯保持不變，它負責合併、排序、繪製照片，並在最後更新匯出按鈕狀態) ...

    // 1. 準備合併列表
    const oldTrailRecords = existingTrailRecords.map(item => ({
        isNew: false,
        dateString: item.time, 
        data: item,
        id: item.id,
        imageSource: item.image 
    }));
    
    const filteredNewRawData = newRawData.filter(d => 
        convertDMSToDD(d.gpsLat, d.gpsLatRef) !== null && d.date
    );

    const newTrailRecords = filteredNewRawData.map((data, index) => ({
        isNew: true,
        dateString: data.date, 
        data: data,
        id: `trail-new-${Date.now()}-${index}` 
    }));

    const allTrailRecords = [...oldTrailRecords, ...newTrailRecords];

    if (allTrailRecords.length === 0) {
        document.getElementById("exportTrailDataBtn").disabled = true;
        document.getElementById("exportTrailJsonBtn").disabled = true;
        document.getElementById("exportConsolidatedDataBtn").disabled = (gpxRawPoints.length === 0);
        return;
    }

    // 2. 排序
    allTrailRecords.sort((a, b) => {
        const dateA = a.isNew ? parseExifDate(a.dateString) : new Date(a.dateString);
        const dateB = b.isNew ? parseExifDate(b.dateString) : new Date(b.dateString);

        if (!dateA || !dateB) return 0;
        return dateA - dateB;
    });

    // 3. 清空和初始化
    Object.values(leafletTrailMarkers).forEach(marker => {
        if (map.hasLayer(marker)) {
            map.removeLayer(marker);
        }
    });
    leafletTrailMarkers = {};
    
    const photoList = document.getElementById("photoList");
    photoList.querySelectorAll('.photo-item').forEach(item => {
        if (item.getAttribute('data-id') && item.getAttribute('data-id').startsWith('trail-')) {
            item.remove();
        }
    });
    
    trailMarkersData = []; 
    let accumulatedDistanceKm = 0;
    let startTimeMs = null;
    let previousPoint = null;

    // 4. 處理並在地圖上重新繪製所有標記
    const reDrawPromises = allTrailRecords.map((item, index) => new Promise(resolve => {
        const photoOrder = index + 1;
        const currentData = item.data;
        const recordId = `trail-rec-${Date.now()}-${photoOrder}`; 
        
        let lat, lon, rawDateStr, imageSource, isNewFile = item.isNew;
        
        if (isNewFile) {
            lat = convertDMSToDD(currentData.gpsLat, currentData.gpsLatRef);
            lon = convertDMSToDD(currentData.gpsLon, currentData.gpsLonRef);
            rawDateStr = currentData.date;
        } else {
            lat = currentData.lat;
            lon = currentData.lon;
            rawDateStr = currentData.rawDateStr || currentData.time; 
            imageSource = currentData.image || item.imageSource; 
        }
        
        if (typeof lat !== 'number' || typeof lon !== 'number' || isNaN(lat) || isNaN(lon)) {
             console.warn(`⚠️ 照片 #${photoOrder} (檔名: ${currentData.name || '舊紀錄'}) 座標無效，已跳過此標記。`);
             resolve();
             return;
        }

        const currentPointDate = isNewFile ? parseExifDate(rawDateStr) : new Date(rawDateStr);
        const currentPointTimeMs = currentPointDate ? currentPointDate.getTime() : null;
        
        let timeElapsedMinutes = 0;
        let distanceSinceLastKm = 0;
        
        if (startTimeMs === null && currentPointTimeMs !== null) {
             startTimeMs = currentPointTimeMs; 
        }

        if (previousPoint && currentPointTimeMs !== null) {
            timeElapsedMinutes = (currentPointTimeMs - previousPoint.timeMs) / (1000 * 60);
            distanceSinceLastKm = haversineDistance(previousPoint.lat, previousPoint.lon, lat, lon);
            accumulatedDistanceKm += distanceSinceLastKm;
        }

        const totalTimeMinutes = currentPointTimeMs ? (currentPointTimeMs - startTimeMs) / (1000 * 60) : 0;
        const formattedDate = currentPointDate ? currentPointDate.toLocaleString() : "未知日期"; 
        
        const finalMarkerData = {
            order: photoOrder,
            time: formattedDate, 
            rawDateStr: rawDateStr, 
            lat: lat,
            lon: lon,
            timeElapsed: timeElapsedMinutes,
            distanceSinceLast: distanceSinceLastKm,
            totalTime: totalTimeMinutes, 
            totalDistance: accumulatedDistanceKm,
            id: recordId,
            name: `登山照片 #${photoOrder}`,
            categories: ["登山紀錄"],
            isTrailMarker: true
        };

        if (isNewFile) {
            if (currentData.isRaw) { 
                 finalMarkerData.image = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200" viewBox="0 0 300 200"><rect fill="#cccccc" width="300" height="200"/><text x="150" y="100" font-family="Arial" font-size="20" fill="#333333" text-anchor="middle">RAW (DNG) 圖片，無法顯示</text></svg>';
                 addMarkerToMap({ ...finalMarkerData, latitude: finalMarkerData.lat, longitude: finalMarkerData.lon });
                 trailMarkersData.push({ ...finalMarkerData }); 
                 resolve();
            } else {
                const reader = new FileReader();
                reader.onload = function(e) {
                    finalMarkerData.image = e.target.result;
                    addMarkerToMap({ ...finalMarkerData, latitude: finalMarkerData.lat, longitude: finalMarkerData.lon });
                    trailMarkersData.push({ ...finalMarkerData, image: e.target.result }); 
                    resolve();
                };
                reader.readAsDataURL(currentData.displayBlob); 
            }
        } else {
            finalMarkerData.image = imageSource;
            addMarkerToMap({ ...finalMarkerData, latitude: finalMarkerData.lat, longitude: finalMarkerData.lon });
            trailMarkersData.push({ ...finalMarkerData }); 
            resolve();
        }

        previousPoint = {
            lat: lat,
            lon: lon,
            timeMs: currentPointTimeMs
        };
    }));

    await Promise.all(reDrawPromises);

    // 5. 處理 JSON 匯入的軌跡線 (如果 JSON 匯入 GPX，需要重繪)
    if (gpxTrack && Array.isArray(gpxTrack) && gpxTrack.length > 0) {
        if (gpxLayer) {
            map.removeLayer(gpxLayer); 
        }
        gpxLayer = L.layerGroup();
        L.polyline(gpxTrack, { color: '#8A2BE2', weight: 4, opacity: 0.8 }).addTo(gpxLayer);
        gpxLayer.addTo(map);
        // JSON 匯入不包含詳細點位數據
        gpxRawPoints = []; 
        document.getElementById("exportGpxDataBtn").disabled = true;
    }


    // 6. 更新匯出按鈕狀態並定位地圖
    document.getElementById("exportTrailDataBtn").disabled = false;
    document.getElementById("exportTrailJsonBtn").disabled = false;
    // 整合匯出鈕的狀態取決於是否有 GPX 或照片
    document.getElementById("exportConsolidatedDataBtn").disabled = !(trailMarkersData.length > 0 || gpxRawPoints.length > 0);
    
    const lastPhoto = trailMarkersData[trailMarkersData.length - 1];
    const lastMarker = leafletTrailMarkers[lastPhoto.id];

    if (lastMarker) {
        map.flyTo([lastPhoto.lat, lastPhoto.lon], 17, { duration: 1.0 });
        lastMarker.openPopup();
    }
}


function exportTrailData() {
    // ... (CSV 匯出照片紀錄函式保持不變) ...
    if (trailMarkersData.length === 0) {
        alert("沒有登山照片數據可供匯出！");
        return;
    }

    trailMarkersData.sort((a, b) => a.order - b.order); 

    let csvContent = "編號,時間,緯度,經度,與前一點時間差(時:分:秒),與前一點距離(公里),累計時間(時:分:秒),累計距離(公里)\n";
    
    trailMarkersData.forEach(item => {
        const timeElapsedHMS = formatMinutesToHMS(item.timeElapsed);
        const totalTimeHMS = formatMinutesToHMS(item.totalTime);

        const time = item.time ? item.time.replace(/,/g, " ") : ""; 
        
        csvContent += `${item.order},"${time}",${item.lat.toFixed(6)},${item.lon.toFixed(6)},${timeElapsedHMS},${item.distanceSinceLast.toFixed(3)},${totalTimeHMS},${item.totalDistance.toFixed(3)}\n`;
    });

    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    
    if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", `登山照片紀錄_${new Date().toISOString().slice(0, 10)}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
}

function exportTrailJson() {
    // ... (JSON 匯出函式保持不變) ...
    if (trailMarkersData.length === 0) {
        alert("沒有登山照片數據可供匯出！");
        return;
    }
    
    let gpxPoints = [];
    if (gpxLayer) {
        gpxLayer.eachLayer(layer => {
            if (layer instanceof L.Polyline) {
                gpxPoints = gpxPoints.concat(layer.getLatLngs().map(latLng => [latLng.lat, latLng.lng]));
            }
        });
    }

    const exportData = {
        hikeName: `登山行程_${new Date().toISOString().slice(0, 10)}`,
        exportTime: new Date().toISOString(),
        gpxTrack: gpxPoints, 
        photoRecords: trailMarkersData.sort((a, b) => a.order - b.order) 
    };

    const jsonString = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });
    const link = document.createElement("a");
    
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `${exportData.hikeName}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function importTrailJson(event) {
    // ... (JSON 匯入函式保持不變) ...
    const file = event.target.files[0];
    if (!file) return;
    
    event.target.value = "";

    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const data = JSON.parse(e.target.result);
            if (!data.photoRecords || !Array.isArray(data.photoRecords)) {
                 throw new Error("JSON 格式不正確，缺少 photoRecords 陣列。");
            }
            
            await processAndRedrawAllTrailRecords([], data.photoRecords, data.gpxTrack || null); 
            
            // 重新繪製 GPX 軌跡後，由於沒有原始數據，禁用 GPX 匯出
            if (data.gpxTrack && data.gpxTrack.length > 0) {
                 gpxRawPoints = [];
                 document.getElementById("exportGpxDataBtn").disabled = true;
            }
            document.getElementById("exportConsolidatedDataBtn").disabled = false;
            
            alert(`✅ 成功匯入行程紀錄: ${data.hikeName || "未命名行程"}，共 ${data.photoRecords.length} 個點位。`);
            
        } catch (error) {
            alert(`❌ 匯入 JSON 檔案失敗: ${error.message}`);
            console.error("JSON 匯入錯誤:", error);
        }
    };
    reader.readAsText(file);
}

function handleClearData() {
    if (!confirm("確定要清除所有登山照片紀錄和 GPX 軌跡嗎？靜態景點將被保留。")) {
        return;
    }
    
    // 清除 GPX 軌跡和數據
    if (gpxLayer) {
        map.removeLayer(gpxLayer);
        gpxLayer = null;
        gpxRawPoints = []; 
    }
    document.getElementById("exportGpxDataBtn").disabled = true;
    document.getElementById("gpxMarkerModeSelect").disabled = true;

    // 移除所有登山照片標記 (紫色的)
    Object.values(leafletTrailMarkers).forEach(marker => {
        if (map.hasLayer(marker)) {
            map.removeLayer(marker);
        }
    });
    leafletTrailMarkers = {};
    trailMarkersData = [];
    
    // 移除列表中的登山照片項目
    const photoList = document.getElementById("photoList");
    photoList.querySelectorAll('.photo-item').forEach(item => {
        if (item.getAttribute('data-id') && item.getAttribute('data-id').startsWith('trail-')) {
            item.remove();
        }
    });

    // 禁用匯出按鈕
    document.getElementById("exportTrailDataBtn").disabled = true;
    document.getElementById("exportTrailJsonBtn").disabled = true;
    document.getElementById("exportConsolidatedDataBtn").disabled = true;

    alert("✅ 所有登山紀錄和 GPX 軌跡已清除！");
}


// ----------------------------------------------------------------------
// ✅ 網站初始化
// ----------------------------------------------------------------------

window.onload = function() {
    console.log("🔵 頁面載入完成，初始化地圖...");
    
    // 初始化地圖 (保持不變)
    map = L.map("map").setView([23.6, 120.9], 9);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);
    
    // 載入景點數據 (保持不變)
    loadAllMarkersFromGitHub();
    
    // 圖片放大 Modal 邏輯 (保持不變)
    const modal = document.getElementById("imageModal");
    const fullImage = document.getElementById("fullImage");
    const closeBtn = document.querySelector(".close");
    
    document.addEventListener("click", function(event) {
        if (event.target.tagName === "IMG" && event.target.closest(".leaflet-popup-content")) {
            if (modal) {
                fullImage.src = event.target.src;
                modal.style.display = "flex";
            }
        }
    });
    
    if (closeBtn) {
        closeBtn.addEventListener("click", function() {
            if (modal) modal.style.display = "none";
        });
    }

    if (modal) {
        modal.addEventListener("click", function(event) {
            if (event.target === modal) {
                modal.style.display = "none";
            }
        });
    }

    // 檔案上傳與匯出按鈕事件 
    const photoUpload = document.getElementById("photoUpload");
    const selectPhotosBtn = document.getElementById("selectPhotosBtn");
    const exportTrailDataBtn = document.getElementById("exportTrailDataBtn");
    const exportTrailJsonBtn = document.getElementById("exportTrailJsonBtn"); 
    const gpxUpload = document.getElementById("gpxUpload");
    const selectGpxBtn = document.getElementById("selectGpxBtn");
    const exportGpxDataBtn = document.getElementById("exportGpxDataBtn"); // 🚩 修正 ID
    const exportConsolidatedDataBtn = document.getElementById("exportConsolidatedDataBtn"); // 🚩 新增 ID
    const jsonUpload = document.getElementById("jsonUpload");
    const selectJsonBtn = document.getElementById("selectJsonBtn");
    const clearDataBtn = document.getElementById("clearDataBtn");
    const gpxMarkerModeSelect = document.getElementById("gpxMarkerModeSelect"); // 🚩 新增 ID

    
    if (selectPhotosBtn && photoUpload) {
        selectPhotosBtn.addEventListener("click", () => photoUpload.click());
        photoUpload.addEventListener("change", handlePhotoUpload);
    }
    if (exportTrailDataBtn) {
        exportTrailDataBtn.addEventListener("click", exportTrailData);
    }
    if (exportTrailJsonBtn) {
        exportTrailJsonBtn.addEventListener("click", exportTrailJson); 
    }
    
    // GPX 匯入事件
    if (selectGpxBtn && gpxUpload) {
        selectGpxBtn.addEventListener("click", () => gpxUpload.click());
        gpxUpload.addEventListener("change", handleGpxUpload); 
    }
    // GPX 數據匯出事件
    if (exportGpxDataBtn) {
        exportGpxDataBtn.addEventListener("click", exportGpxData);
        exportGpxDataBtn.disabled = true; 
    }
    // 整合匯出事件
    if (exportConsolidatedDataBtn) {
        exportConsolidatedDataBtn.addEventListener("click", exportConsolidatedData);
        exportConsolidatedDataBtn.disabled = true;
    }
    
    // JSON 匯入事件
    if (selectJsonBtn && jsonUpload) {
        selectJsonBtn.addEventListener("click", () => jsonUpload.click());
        jsonUpload.addEventListener("change", importTrailJson); 
    }
    
    // 清除資料事件
    if (clearDataBtn) {
        clearDataBtn.addEventListener("click", handleClearData);
    }
    
    // 🚩 新增：GPX 模式切換事件 (Q1)
    if (gpxMarkerModeSelect) {
        gpxMarkerModeSelect.addEventListener("change", function(event) {
            toggleGpxView(event.target.value);
        });
        gpxMarkerModeSelect.disabled = true;
    }
};
