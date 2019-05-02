function _keepPromise (fx) {
    return new Promise((resolve, reject) => {
      fx((error, value) => {
        error ? reject(error) : resolve(value);
      });
    });
}

module.exports = _keepPromise;