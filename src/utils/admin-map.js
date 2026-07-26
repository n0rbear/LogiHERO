function renderAdminMapScript() {
    return `
        <script>
            const L = {
                map(id) {
                    const el = document.getElementById(id);
                    const map = {
                        el,
                        setView() { return map; },
                        fitBounds() { return map; }
                    };
                    if (el) {
                        el.classList.add('simple-map');
                        el.innerHTML = '<div class="simple-map-layer"></div>';
                    }
                    return map;
                },
                tileLayer() {
                    return { addTo() { return this; } };
                },
                layerGroup() {
                    const markers = [];
                    return {
                        addTo(map) {
                            this.map = map;
                            return this;
                        },
                        clearLayers() {
                            markers.splice(0).forEach(marker => marker.el?.remove());
                        },
                        addMarker(marker) {
                            markers.push(marker);
                            this.map?.el?.querySelector('.simple-map-layer')?.appendChild(marker.el);
                        }
                    };
                },
                marker(latlng) {
                    const marker = document.createElement('button');
                    marker.type = 'button';
                    marker.className = 'simple-map-marker';
                    marker.style.left = Math.max(4, Math.min(94, ((Number(latlng[1]) + 180) / 360) * 100)) + '%';
                    marker.style.top = Math.max(4, Math.min(94, ((90 - Number(latlng[0])) / 180) * 100)) + '%';
                    return {
                        el: marker,
                        addTo(layer) {
                            layer.addMarker(this);
                            return this;
                        },
                        bindPopup(html) {
                            marker.title = String(html || '').replace(/<[^>]*>/g, ' ');
                            return this;
                        }
                    };
                },
                divIcon() {
                    return {};
                },
                polyline(latlngs) {
                    return {
                        addTo(layer) {
                            (latlngs || []).forEach(point => L.marker(point).addTo(layer));
                            return this;
                        }
                    };
                }
            };
        </script>
    `;
}

function renderAdminMapStyles() {
    return `
        .simple-map { position: relative; overflow: hidden; background: #e8edf2; }
        .simple-map::before {
            content: "";
            position: absolute;
            inset: 0;
            background:
                linear-gradient(90deg, rgba(255,255,255,.35) 1px, transparent 1px),
                linear-gradient(0deg, rgba(255,255,255,.35) 1px, transparent 1px);
            background-size: 48px 48px;
        }
        .simple-map-layer { position: absolute; inset: 0; }
        .simple-map-marker {
            position: absolute;
            width: 18px;
            height: 18px;
            border-radius: 50%;
            border: 2px solid #fff;
            background: var(--color-brand);
            box-shadow: 0 2px 8px rgba(0,0,0,.25);
            transform: translate(-50%, -50%);
        }
    `;
}

module.exports = {
    renderAdminMapScript,
    renderAdminMapStyles
};
