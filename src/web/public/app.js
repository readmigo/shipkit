function app() {
  return {
    currentView: 'dashboard',
    mobileSidebar: false,
    stores: [],
    builds: [],
    jobs: [],
    statusResults: [],
    publishResults: [],
    uploading: false,
    publishing: false,
    notification: null,
    selectedFile: null,
    dragover: false,
    uploadForm: { appId: '', storeId: '', fileType: '' },
    publishForm: { appId: '', buildId: '', storeIds: [], versionName: '', releaseNotes: '' },
    statusAppId: '',
    jobFilter: 'all',
    configModal: { open: false, storeId: '', credentials: {} },
    eventSource: null,
    _jobInterval: null,
    _quotaInterval: null,
    _charts: {},
    analytics: {
      overview: {},
      tools: [],
      stores: [],
      trends: [],
      quota: null,
      quotaApiKeyId: '',
    },

    init() {
      this.fetchStores();
      this.fetchJobs();
      this._jobInterval = setInterval(() => this.fetchJobs(), 10000);

      this.$watch('currentView', (newView, oldView) => {
        if (oldView === 'status' && this.eventSource) {
          this.eventSource.close();
          this.eventSource = null;
        }
        if (newView !== 'analytics' && this._quotaInterval) {
          clearInterval(this._quotaInterval);
          this._quotaInterval = null;
        }
      });
    },

    destroy() {
      if (this._jobInterval) clearInterval(this._jobInterval);
      if (this._quotaInterval) clearInterval(this._quotaInterval);
      if (this.eventSource) this.eventSource.close();
      Object.values(this._charts).forEach(ch => ch.destroy());
    },

    // ==================== API Methods ====================

    async fetchStores() {
      try {
        const res = await fetch('/api/stores');
        if (!res.ok) throw new Error('Failed to fetch stores');
        const data = await res.json();
        this.stores = data.stores || [];
      } catch (e) {
        this.showNotification('error', 'Failed to load stores: ' + e.message);
      }
    },

    async fetchBuilds(appId) {
      try {
        const params = new URLSearchParams();
        if (appId) params.set('app_id', appId);
        const res = await fetch('/api/builds?' + params.toString());
        if (!res.ok) throw new Error('Failed to fetch builds');
        const data = await res.json();
        this.builds = data.builds || [];
      } catch (e) {
        this.showNotification('error', 'Failed to load builds: ' + e.message);
      }
    },

    async fetchJobs() {
      try {
        const params = new URLSearchParams();
        if (this.jobFilter !== 'all') params.set('status', this.jobFilter);
        const res = await fetch('/api/jobs?' + params.toString());
        if (!res.ok) throw new Error('Failed to fetch jobs');
        const data = await res.json();
        this.jobs = data.jobs || [];
      } catch (e) {
        // Silently fail on auto-refresh, only show error on first load
        if (this.jobs.length === 0) {
          this.showNotification('error', 'Failed to load jobs: ' + e.message);
        }
      }
    },

    async uploadBuild(event) {
      if (!this.selectedFile || !this.uploadForm.appId || !this.uploadForm.storeId) return;

      this.uploading = true;
      try {
        const formData = new FormData();
        formData.append('file', this.selectedFile);
        formData.append('app_id', this.uploadForm.appId);
        formData.append('store_id', this.uploadForm.storeId);
        if (this.uploadForm.fileType) {
          formData.append('file_type', this.uploadForm.fileType);
        }

        const res = await fetch('/api/builds/upload', {
          method: 'POST',
          body: formData,
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ message: 'Upload failed' }));
          throw new Error(err.message || 'Upload failed');
        }

        const data = await res.json();
        this.showNotification('success', 'Build uploaded successfully! ID: ' + data.build_id.slice(0, 8));
        this.selectedFile = null;
        this.uploadForm = { appId: '', storeId: '', fileType: '' };
        this.fetchBuilds();
      } catch (e) {
        this.showNotification('error', 'Upload failed: ' + e.message);
      } finally {
        this.uploading = false;
      }
    },

    async publishToStores() {
      if (!this.publishForm.buildId || this.publishForm.storeIds.length === 0) return;

      this.publishing = true;
      this.publishResults = [];
      try {
        const body = {
          app_id: this.publishForm.appId,
          build_id: this.publishForm.buildId,
          store_ids: this.publishForm.storeIds,
        };
        if (this.publishForm.versionName) body.version_name = this.publishForm.versionName;
        if (this.publishForm.releaseNotes) body.release_notes = this.publishForm.releaseNotes;

        const res = await fetch('/api/publish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ message: 'Publish failed' }));
          throw new Error(err.message || 'Publish failed');
        }

        const data = await res.json();
        this.publishResults = data.results || [];

        const succeeded = this.publishResults.filter(r => r.success).length;
        const total = this.publishResults.length;
        if (succeeded === total) {
          this.showNotification('success', 'Published to all ' + total + ' store(s) successfully!');
        } else {
          this.showNotification('error', succeeded + '/' + total + ' stores published. Check results for details.');
        }
      } catch (e) {
        this.showNotification('error', 'Publish failed: ' + e.message);
      } finally {
        this.publishing = false;
      }
    },

    async checkStatus() {
      if (!this.statusAppId) return;
      try {
        const res = await fetch('/api/status/' + encodeURIComponent(this.statusAppId));
        if (!res.ok) throw new Error('Failed to check status');
        const data = await res.json();
        this.statusResults = data.statuses || [];
        this.connectSSE();
      } catch (e) {
        this.showNotification('error', 'Status check failed: ' + e.message);
      }
    },

    connectSSE() {
      if (this.eventSource) {
        this.eventSource.close();
      }
      if (!this.statusAppId) return;

      this.eventSource = new EventSource('/api/status/stream/' + encodeURIComponent(this.statusAppId));

      this.eventSource.addEventListener('status_change', (event) => {
        try {
          const data = JSON.parse(event.data);
          const idx = this.statusResults.findIndex(s => s.storeId === data.storeId);
          if (idx >= 0) {
            this.statusResults[idx] = { ...this.statusResults[idx], ...data };
          } else {
            this.statusResults.push(data);
          }
        } catch (e) {
          // Ignore malformed SSE data
        }
      });

      this.eventSource.onerror = () => {
        this.eventSource.close();
        // Auto-reconnect after 5 seconds
        setTimeout(() => {
          if (this.currentView === 'status' && this.statusAppId) {
            this.connectSSE();
          }
        }, 5000);
      };
    },

    async configureStore() {
      try {
        const res = await fetch('/api/stores/' + encodeURIComponent(this.configModal.storeId) + '/connect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ credentials: this.configModal.credentials }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ message: 'Configuration failed' }));
          throw new Error(err.message || 'Configuration failed');
        }

        const data = await res.json();
        this.showNotification('success', data.message || 'Store connected successfully!');
        this.configModal.open = false;
        this.fetchStores();
      } catch (e) {
        this.showNotification('error', 'Failed to configure store: ' + e.message);
      }
    },

    async retryJob(jobId) {
      try {
        const res = await fetch('/api/jobs/' + encodeURIComponent(jobId) + '/retry', {
          method: 'POST',
        });
        if (!res.ok) throw new Error('Retry failed');
        this.showNotification('success', 'Job retry initiated');
        this.fetchJobs();
      } catch (e) {
        this.showNotification('error', 'Retry failed: ' + e.message);
      }
    },

    // ==================== Analytics Methods ====================

    async loadAnalytics() {
      await Promise.all([
        this.fetchAnalyticsOverview(),
        this.fetchAnalyticsTrends(),
        this.fetchAnalyticsTools(),
        this.fetchAnalyticsStores(),
      ]);

      // Set up 30s auto-refresh for quota if loaded
      if (!this._quotaInterval) {
        this._quotaInterval = setInterval(() => {
          if (this.currentView === 'analytics' && this.analytics.quota) {
            this.loadQuota();
          }
        }, 30000);
      }

      // Render charts after data is available
      this.$nextTick(() => this.renderCharts());
    },

    async fetchAnalyticsOverview() {
      try {
        const res = await fetch('/api/analytics/overview');
        if (!res.ok) return;
        this.analytics.overview = await res.json();
      } catch (_) { /* silently ignore */ }
    },

    async fetchAnalyticsTrends() {
      try {
        const res = await fetch('/api/analytics/trends?days=30');
        if (res.status === 401) { this.analytics.trends = []; return; }
        if (!res.ok) return;
        const data = await res.json();
        this.analytics.trends = data.trends || [];
      } catch (_) { /* silently ignore */ }
    },

    async fetchAnalyticsTools() {
      try {
        const res = await fetch('/api/analytics/tools');
        if (res.status === 401) { this.analytics.tools = []; return; }
        if (!res.ok) return;
        const data = await res.json();
        this.analytics.tools = data.tools || [];
      } catch (_) { /* silently ignore */ }
    },

    async fetchAnalyticsStores() {
      try {
        const res = await fetch('/api/analytics/stores');
        if (res.status === 401) { this.analytics.stores = []; return; }
        if (!res.ok) return;
        const data = await res.json();
        this.analytics.stores = data.stores || [];
      } catch (_) { /* silently ignore */ }
    },

    async loadQuota() {
      const id = this.analytics.quotaApiKeyId?.trim();
      if (!id) return;
      try {
        const res = await fetch('/api/analytics/quota?apiKeyId=' + encodeURIComponent(id));
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          this.showNotification('error', err.error || 'Failed to load quota');
          return;
        }
        this.analytics.quota = await res.json();
      } catch (e) {
        this.showNotification('error', 'Failed to load quota: ' + e.message);
      }
    },

    renderCharts() {
      // Destroy stale chart instances before redraw
      ['trendChart', 'storeChart', 'toolChart'].forEach(id => {
        if (this._charts[id]) { this._charts[id].destroy(); delete this._charts[id]; }
      });

      // Trend line chart
      const trendCanvas = document.getElementById('trendChart');
      if (trendCanvas && this.analytics.trends.length > 0) {
        this._charts.trendChart = new Chart(trendCanvas, {
          type: 'line',
          data: {
            labels: this.analytics.trends.map(t => t.date),
            datasets: [
              {
                label: 'Total Calls',
                data: this.analytics.trends.map(t => t.totalCalls),
                borderColor: '#6366f1',
                backgroundColor: 'rgba(99,102,241,0.1)',
                tension: 0.3,
                fill: true,
                pointRadius: 3,
              },
              {
                label: 'Success',
                data: this.analytics.trends.map(t => t.successCalls),
                borderColor: '#22c55e',
                backgroundColor: 'transparent',
                tension: 0.3,
                pointRadius: 2,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 } } } },
            scales: { x: { ticks: { maxTicksLimit: 7, font: { size: 10 } } }, y: { beginAtZero: true, ticks: { font: { size: 10 } } } },
          },
        });
      }

      // Store doughnut chart
      const storeCanvas = document.getElementById('storeChart');
      if (storeCanvas && this.analytics.stores.length > 0) {
        const colors = ['#6366f1','#22c55e','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#ec4899','#14b8a6'];
        this._charts.storeChart = new Chart(storeCanvas, {
          type: 'doughnut',
          data: {
            labels: this.analytics.stores.map(s => s.storeId),
            datasets: [{
              data: this.analytics.stores.map(s => s.totalCalls),
              backgroundColor: this.analytics.stores.map((_, i) => colors[i % colors.length]),
              borderWidth: 2,
            }],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'right', labels: { boxWidth: 12, font: { size: 10 } } } },
            cutout: '65%',
          },
        });
      }

      // Tool bar chart
      const toolCanvas = document.getElementById('toolChart');
      if (toolCanvas && this.analytics.tools.length > 0) {
        const top = this.analytics.tools.slice(0, 8);
        this._charts.toolChart = new Chart(toolCanvas, {
          type: 'bar',
          data: {
            labels: top.map(t => t.toolName),
            datasets: [{
              label: 'Total Calls',
              data: top.map(t => t.totalCalls),
              backgroundColor: 'rgba(99,102,241,0.7)',
              borderColor: '#6366f1',
              borderWidth: 1,
            }],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: 'y',
            plugins: { legend: { display: false } },
            scales: { x: { beginAtZero: true, ticks: { font: { size: 10 } } }, y: { ticks: { font: { size: 10 } } } },
          },
        });
      }
    },

    // ==================== UI Helpers ====================

    openConfigModal(store) {
      this.configModal = {
        open: true,
        storeId: store.storeId,
        credentials: {},
      };
    },

    handleFileSelect(event) {
      const file = event.target.files[0];
      if (file) {
        this.selectedFile = file;
        this.autoDetectFileType(file.name);
      }
    },

    handleDrop(event) {
      this.dragover = false;
      const file = event.dataTransfer.files[0];
      if (file) {
        this.selectedFile = file;
        this.autoDetectFileType(file.name);
      }
    },

    autoDetectFileType(filename) {
      const ext = filename.split('.').pop().toLowerCase();
      const typeMap = { apk: 'apk', aab: 'aab', ipa: 'ipa', zip: 'zip' };
      this.uploadForm.fileType = typeMap[ext] || '';
    },

    filteredJobs() {
      if (this.jobFilter === 'all') return this.jobs;
      return this.jobs.filter(j => j.status === this.jobFilter);
    },

    showNotification(type, message) {
      this.notification = { type, message };
      setTimeout(() => {
        this.notification = null;
      }, 3000);
    },

    relativeTime(dateStr) {
      if (!dateStr) return '—';
      const now = Date.now();
      const then = new Date(dateStr).getTime();
      const diff = now - then;

      if (diff < 0) return 'just now';

      const seconds = Math.floor(diff / 1000);
      if (seconds < 60) return seconds + 's ago';

      const minutes = Math.floor(seconds / 60);
      if (minutes < 60) return minutes + ' min ago';

      const hours = Math.floor(minutes / 60);
      if (hours < 24) return hours + ' hour' + (hours > 1 ? 's' : '') + ' ago';

      const days = Math.floor(hours / 24);
      if (days < 30) return days + ' day' + (days > 1 ? 's' : '') + ' ago';

      const months = Math.floor(days / 30);
      return months + ' month' + (months > 1 ? 's' : '') + ' ago';
    },

    getStatusColor(status) {
      const colors = {
        approved: 'bg-green-100 text-green-700',
        live: 'bg-green-100 text-green-700',
        in_review: 'bg-yellow-100 text-yellow-700',
        pending_review: 'bg-yellow-100 text-yellow-700',
        rejected: 'bg-red-100 text-red-700',
        draft: 'bg-gray-100 text-gray-600',
        not_found: 'bg-gray-100 text-gray-500',
      };
      return colors[status] || 'bg-gray-100 text-gray-600';
    },

    getJobStatusClass(status) {
      const classes = {
        completed: 'bg-green-100 text-green-700',
        running: 'bg-blue-100 text-blue-700',
        pending: 'bg-yellow-100 text-yellow-700',
        failed: 'bg-red-100 text-red-700',
      };
      return classes[status] || 'bg-gray-100 text-gray-600';
    },

    formatFileSize(bytes) {
      if (!bytes) return '0 B';
      const units = ['B', 'KB', 'MB', 'GB'];
      let i = 0;
      let size = bytes;
      while (size >= 1024 && i < units.length - 1) {
        size /= 1024;
        i++;
      }
      return size.toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
    },
  };
}
