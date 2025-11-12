let counter = 0;

module.exports = {
	nanoid: () => {
		return `test_id_${counter++}_${Date.now()}`;
	},
};
