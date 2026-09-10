window.RevealVideoFragments = function () {
  return {
    id: "RevealVideoFragments",
    init: function (deck) {
      let autoStopTimer = null;

      deck.on('fragmentshown', function (event) {
        handleVideoFragment(event.fragment, true);
      });

      deck.on('fragmenthidden', function (event) {
        handleVideoFragment(event.fragment, false);
      });

      function scheduleStop(video, end) {
        if (!isNaN(end)) {
          const delay = (end - video.currentTime) * 1000;
          autoStopTimer = setTimeout(function () {
            video.pause();
          }, delay);
        }
      }

      function handleVideoFragment(fragment, shown) {
        const video = fragment.closest('section').querySelector('video');
        if (!video) return;

        if (fragment.classList.contains('video-play')) {
          const start = parseFloat(fragment.dataset.videoStart);
          const end   = parseFloat(fragment.dataset.videoEnd);

          if (shown) {
            video.play().then(function () {
              if (!isNaN(start)) video.currentTime = start;
              scheduleStop(video, end);
            });
          } else {
            clearTimeout(autoStopTimer);
            autoStopTimer = null;
            video.pause();
            video.currentTime = !isNaN(start) ? start : 0;
          }
        }
      }
    }
  };
};
