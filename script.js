// 📌 全域範圍變數
let map;
let markers = []; // 儲存所有地圖上的標記 (JSON 景點)
let leafletTrailMarkers = {}; // 儲存 Leaflet 登山照片標記實例，用於列表點擊和自動定位
let trailMarkersData = []; // 儲存所有上傳照片的數據，用於匯出/匯入
let gpxLayer = null; // 用來存儲 GPX 軌跡圖層
let gpxHourlyMarkersData = []; // 儲存 GPX 整點點位數據，用於 CSV 匯出

// GPX 濾波器參數 (人類徒步極限速度 20 km/h)
const MAX_HUMAN_SPEED_KMH = 20; 
// GPS 中斷門檻 (超過 18 分鐘未記錄，強制斷開連線)
const MAX_TIME_GAP_HOURS = 0.3;

// 📌 JSON 檔案 URL 列表 (官方景點數據)
const jsonUrls = [
    //"https://piceayee.github.io/jsonhome/data/0310A.json",
    //"https://piceayee.github.io/jsonhome/data/0310B.json",
    //"https://piceayee.github.io/jsonhome/data/edit1-1.json",
    //"https://piceayee.github.io/jsonhome/data/edit2-1.json",
    //"https://piceayee.github.io/jsonhome/data/edit3-1.json"
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
    const R = 6371;
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a = 
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
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
    const gpsLink = `https://www.google.com/maps/search/?api=1&query=$${markerData.latitude},${markerData.longitude}`;

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
// ✅ GPX 軌跡處理 (整點追蹤與匯出)
// ----------------------------------------------------------------------

function handleGpxUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    event.target.value = "";

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            parseAndDrawGpx(e.target.result);
            document.getElementById("exportGpxHourlyBtn").disabled = false;
        } catch (error) {
            alert("❌ GPX 檔案解析失敗，請確認格式是否正確。");
            console.error("GPX 解析錯誤:", error);
            document.getElementById("exportGpxHourlyBtn").disabled = true;
        }
    };
    reader.readAsText(file);
}

// 解析 GPX 內容並在地圖上繪製軌跡 (含速度濾波器)
function parseAndDrawGpx(gpxText) {
    if (gpxLayer) {
        map.removeLayer(gpxLayer); 
    }

    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(gpxText, "text/xml");
    
    const rawPoints = []; 
    const points = xmlDoc.querySelectorAll('trkpt, rtept, wpt');
    
    points.forEach(pt => {
        const lat = parseFloat(pt.getAttribute('lat'));
        const lon = parseFloat(pt.getAttribute('lon'));
        const timeElement = pt.querySelector('time');
        
        let timeMs = null;
        let timeString = null;
        if (timeElement) {
            timeString = timeElement.textContent;
            timeMs = new Date(timeString).getTime();
        }

        if (!isNaN(lat) && !isNaN(lon)) {
            rawPoints.push({ lat, lon, timeMs, timeString }); 
        }
    });

    if (rawPoints.length === 0) {
        alert("GPX 檔案中未找到有效的軌跡點 (trkpt, rtept 或 wpt)。");
        return;
    }
    
    // 1. 識別整點點位 (核心邏輯：只標記整點、起點、終點)
    gpxHourlyMarkersData = [];
    const startTimeMs = rawPoints[0].timeMs;
    const endTimeMs = rawPoints[rawPoints.length - 1].timeMs;
    let nextHourMs = 0;

    if (startTimeMs) {
        // 計算第一個 upcoming hour mark
        const startHourDate = new Date(startTimeMs);
        startHourDate.setUTCMinutes(0, 0, 0); 
        startHourDate.setUTCHours(startHourDate.getUTCHours() + 1);
        nextHourMs = startHourDate.getTime();
    }
    
    // 確保第一個點加入 (作為起點標記)
    if (rawPoints[0].timeMs) {
         gpxHourlyMarkersData.push(rawPoints[0]);
    }

    let lastCheckedIndex = 0;
    while (nextHourMs < endTimeMs) {
        let closestPoint = null;
        let minTimeDiff = Infinity;
        
        // 僅從上次檢查的位置向前搜尋
        for (let i = lastCheckedIndex; i < rawPoints.length; i++) {
            const currentPoint = rawPoints[i];
            if (!currentPoint.timeMs) continue;

            // 如果當前點已經超過下一個整點標記目標 30 分鐘，則停止本次搜尋
            if (currentPoint.timeMs > nextHourMs + (30 * 60 * 1000)) { 
                lastCheckedIndex = i;
                break;
            }
            
            const timeDiff = Math.abs(currentPoint.timeMs - nextHourMs);

            // 如果點在整點附近 (+- 30 分鐘) 且比目前找到的更接近
            if (timeDiff <= (30 * 60 * 1000) && timeDiff < minTimeDiff) {
                minTimeDiff = timeDiff;
                closestPoint = currentPoint;
            }
        }
        
        // 加入找到的最接近點，並確保不重複
        if (closestPoint && gpxHourlyMarkersData.length > 0 && gpxHourlyMarkersData[gpxHourlyMarkersData.length - 1].timeMs !== closestPoint.timeMs) {
             gpxHourlyMarkersData.push(closestPoint);
        } else if (closestPoint && gpxHourlyMarkersData.length === 0) {
             gpxHourlyMarkersData.push(closestPoint);
        }
        
        // 移至下一個整點
        nextHourMs += 1000 * 60 * 60; 
        
        if (nextHourMs > endTimeMs + (1000 * 60 * 60 * 2)) break; // 避免極端情況下的無限迴圈
    }

    // 確保最後一個點加入 (作為終點標記)
    const lastRawPoint = rawPoints[rawPoints.length - 1];
    if (gpxHourlyMarkersData.length === 0 || gpxHourlyMarkersData[gpxHourlyMarkersData.length - 1].timeMs !== lastRawPoint.timeMs) {
        gpxHourlyMarkersData.push(lastRawPoint);
    }


    // 2. 實作速度濾波器 (保持軌跡線的繪製邏輯)
    const filteredSegments = [];
    let currentSegment = [];

    for (let i = 0; i < rawPoints.length; i++) {
        const p1 = rawPoints[i];
        
        if (i === 0) {
            currentSegment.push([p1.lat, p1.lon]);
            continue;
        }

        const p0 = rawPoints[i - 1];
        
        const distanceKm = haversineDistance(p0.lat, p0.lon, p1.lat, p1.lon);
        const timeDiffHours = (p1.timeMs - p0.timeMs) / (1000 * 60 * 60);

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
    }
    
    if (currentSegment.length > 1) {
        filteredSegments.push(currentSegment);
    }

    // 3. 繪製軌跡和點位
    gpxLayer = L.layerGroup();
    filteredSegments.forEach(segment => {
        L.polyline(segment, {
            color: '#8A2BE2', // 紫色軌跡線
            weight: 4,
            opacity: 0.8
        }).addTo(gpxLayer);
    });

    // 🚩 繪製整點點位 (紅色大圓點)
    const uniqueHourlyMarkers = new Set();
    gpxHourlyMarkersData.forEach(pt => {
         const key = `${pt.lat.toFixed(6)},${pt.lon.toFixed(6)},${pt.timeMs}`; // 加上時間戳記確保唯一性
         if (!uniqueHourlyMarkers.has(key)) {
            uniqueHourlyMarkers.add(key);
            
            const dateObj = pt.timeMs ? new Date(pt.timeMs) : null;
            // 由於 GPX 時間是 UTC，這裡轉換為本地時間顯示
            const timeStr = dateObj ? dateObj.toLocaleString() : '時間未知'; 
            
            L.circleMarker([pt.lat, pt.lon], {
                radius: 6, 
                color: '#FF0000', // 紅色標示整點
                fillColor: '#FF0000',
                fillOpacity: 1,
                weight: 2
            }).bindPopup(`<strong>整點紀錄</strong><br>時間: ${timeStr}<br>GPS: ${pt.lat.toFixed(5)}, ${pt.lon.toFixed(5)}`).addTo(gpxLayer);
        }
    });
    
    gpxLayer.addTo(map);

    const allPoints = filteredSegments.flat();
    if (allPoints.length > 0) {
        map.fitBounds(L.latLngBounds(allPoints), { padding: [50, 50] });
    }
    
    console.log(`✅ 成功匯入 GPX 軌跡，共 ${rawPoints.length} 個點，識別出 ${gpxHourlyMarkersData.length} 個整點/起終點紀錄。`);
}

// 匯出 GPX 整點資料功能
function exportGpxHourlyData() {
    if (gpxHourlyMarkersData.length === 0) {
        alert("沒有 GPX 整點數據可供匯出！");
        return;
    }

    let csvContent = "時間,緯度,經度\n";
    
    gpxHourlyMarkersData.forEach(item => {
        const dateObj = item.timeMs ? new Date(item.timeMs) : null;
        // 轉換為本地時間顯示
        const time = dateObj ? dateObj.toLocaleString().replace(/,/g, " ") : "未知時間";
        
        csvContent += `"${time}",${item.lat.toFixed(6)},${item.lon.toFixed(6)}\n`;
    });

    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    
    if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", `GPX_整點紀錄_${new Date().toISOString().slice(0, 10)}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
}


// ----------------------------------------------------------------------
// ✅ HEIC 檔案處理
// ----------------------------------------------------------------------

// 處理單一檔案，如果是 HEIC 則轉換為 JPEG 
async function processFile(file) {
    if (file.type.includes('heic') || file.type.includes('heif') || file.name.toLowerCase().endsWith('.heic') || file.name.toLowerCase().endsWith('.heif')) {
        console.log(`ℹ️ 正在轉換 HEIC 檔案: ${file.name}`);
        try {
            if (typeof heic2any !== 'function') {
                console.error("❌ HEIC 轉換失敗：heic2any 函式庫未載入。");
                alert(`HEIC 轉換失敗：heic2any 函式庫未載入。檔案 ${file.name} 將被跳過。`);
                return null;
            }
            
            const jpegBlob = await heic2any({
                blob: file,
                toType: "image/jpeg",
                quality: 0.8
            });
            
            return {
                originalFile: file,
                displayBlob: jpegBlob, 
                isHeic: true
            };
        } catch (error) {
            console.error(`❌ HEIC 轉換失敗: ${file.name}`, error);
            alert(`HEIC 轉換失敗: ${file.name}。錯誤代碼：${error.code}。可能原因：檔案格式不完全支援或損壞。`);
            return null; 
        }
    }
    return {
        originalFile: file,
        displayBlob: file, 
        isHeic: false
    };
}


// ----------------------------------------------------------------------
// ✅ 照片/行程紀錄處理 (核心邏輯：合併、排序、繪圖)
// ----------------------------------------------------------------------

// 核心修正：統一處理所有照片記錄 (新上傳、舊紀錄、JSON匯入) 的排序和繪圖
async function processAndRedrawAllTrailRecords(newRawData, existingTrailRecords, gpxTrack = null) {
    
    // 1. 準備合併列表：新舊照片數據統一結構
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
        return;
    }

    // 2. 排序：將所有新舊紀錄依日期時間排序
    allTrailRecords.sort((a, b) => {
        const dateA = a.isNew ? parseExifDate(a.dateString) : new Date(a.dateString);
        const dateB = b.isNew ? parseExifDate(b.dateString) : new Date(b.dateString);

        if (!dateA || !dateB) return 0;
        return dateA - dateB;
    });

    // 3. 清空和初始化 (只清除登山紀錄，保留靜態景點)
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
            const reader = new FileReader();
            reader.onload = function(e) {
                finalMarkerData.image = e.target.result;
                addMarkerToMap({ ...finalMarkerData, latitude: finalMarkerData.lat, longitude: finalMarkerData.lon });
                trailMarkersData.push({ ...finalMarkerData, image: e.target.result }); 
                resolve();
            };
            reader.readAsDataURL(currentData.displayBlob);
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

    // 5. 處理 JSON 匯入的軌跡線
    if (gpxTrack && Array.isArray(gpxTrack) && gpxTrack.length > 0) {
        if (gpxLayer) {
            map.removeLayer(gpxLayer); 
        }
        gpxLayer = L.layerGroup();
        L.polyline(gpxTrack, {
            color: '#8A2BE2', 
            weight: 4,
            opacity: 0.8
        }).addTo(gpxLayer);
        gpxLayer.addTo(map);
        // JSON 匯入無法提供整點數據
        gpxHourlyMarkersData = []; 
        document.getElementById("exportGpxHourlyBtn").disabled = true;
    }


    // 6. 更新匯出按鈕狀態並定位地圖
    document.getElementById("exportTrailDataBtn").disabled = false;
    document.getElementById("exportTrailJsonBtn").disabled = false;
    
    const lastPhoto = trailMarkersData[trailMarkersData.length - 1];
    const lastMarker = leafletTrailMarkers[lastPhoto.id];

    if (lastMarker) {
        map.flyTo([lastPhoto.lat, lastPhoto.lon], 17, { duration: 1.0 });
        lastMarker.openPopup();
    }
}


// 處理上傳照片 (更新為呼叫新的核心處理函式)
async function handlePhotoUpload(event) {
    const files = Array.from(event.target.files);
    if (files.length === 0) return;

    // 1. 處理新上傳檔案 (包含 HEIC 轉換和 EXIF 讀取)
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
                name: p.originalFile.name 
            };
            resolve(data);
        });
    }));

    let newRawData = await Promise.all(promises);
    
    // 2. 呼叫核心處理函式，傳入新數據和現有數據
    await processAndRedrawAllTrailRecords(newRawData, trailMarkersData); 
    
    event.target.value = "";
}

// ----------------------------------------------------------------------
// ✅ 匯出/匯入/清除 功能
// ----------------------------------------------------------------------

// 匯出照片紀錄資料功能 (CSV)
function exportTrailData() {
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


// 導出整個登山行程為 JSON 檔案
function exportTrailJson() {
    if (trailMarkersData.length === 0) {
        alert("沒有登山照片數據可供匯出！");
        return;
    }
    
    let gpxPoints = [];
    if (gpxLayer) {
        gpxLayer.eachLayer(layer => {
            if (layer instanceof L.Polyline) {
                // 將軌跡線的 LatLngs 轉換為 [lat, lng] 陣列
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

// 匯入行程 JSON 函式
function importTrailJson(event) {
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
            
            // 處理照片紀錄：將 JSON 內的紀錄視為舊紀錄，並與可能已在頁面上的紀錄合併 (雖然通常建議先清除)
            await processAndRedrawAllTrailRecords([], data.photoRecords, data.gpxTrack || null); 
            
            alert(`✅ 成功匯入行程紀錄: ${data.hikeName || "未命名行程"}，共 ${data.photoRecords.length} 個點位。`);
            
        } catch (error) {
            alert(`❌ 匯入 JSON 檔案失敗: ${error.message}`);
            console.error("JSON 匯入錯誤:", error);
        }
    };
    reader.readAsText(file);
}

// 清除所有登山紀錄、GPX 軌跡
function handleClearData() {
    if (!confirm("確定要清除所有登山照片紀錄和 GPX 軌跡嗎？靜態景點將被保留。")) {
        return;
    }
    
    // 清除 GPX 軌跡和數據
    if (gpxLayer) {
        map.removeLayer(gpxLayer);
        gpxLayer = null;
        gpxHourlyMarkersData = [];
    }
    document.getElementById("exportGpxHourlyBtn").disabled = true;

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

    alert("✅ 所有登山紀錄和 GPX 軌跡已清除！");
}


// ----------------------------------------------------------------------
// ✅ 網站初始化
// ----------------------------------------------------------------------

window.onload = function() {
    console.log("🔵 頁面載入完成，初始化地圖...");
    
    // 初始化地圖
    map = L.map("map").setView([24.46, 118.35], 12);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);
    
    // 載入景點數據
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
    const exportGpxHourlyBtn = document.getElementById("exportGpxHourlyBtn"); 
    const jsonUpload = document.getElementById("jsonUpload");
    const selectJsonBtn = document.getElementById("selectJsonBtn");
    const clearDataBtn = document.getElementById("clearDataBtn");
    
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
    // GPX 整點匯出事件
    if (exportGpxHourlyBtn) {
        exportGpxHourlyBtn.addEventListener("click", exportGpxHourlyData);
        exportGpxHourlyBtn.disabled = true; // 預設禁用
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
};
